package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// orderPlacement is everything it takes to place an order — typed in on the #90 form, or a draft promoted from its
// page. Both are OrderCreate now (a-draft-becomes-an-order-through-order-create): ONE door, so the rule for what an order
// must have lives in exactly one place. OrderDraftPromote was a second door that rebuilt the order by hand, and it had
// already drifted — it never set the marketplace ref.
type orderPlacement struct {
	teamID      uint64
	shopID      uint64
	warehouseID uint64

	customerName  string
	customerPhone string
	// The buyer's marketplace username, as given. Trimmed when the row is written, on both doors; "" = none, and never
	// a reason to refuse (the-buyers-username-is-optional) — so validate does not look at it.
	buyerUsername string
	address       *sellingv1.OrderAddress
	shippingCode  string
	// What whoever took the order wrote down for the people who handle it — written as the order's FIRST NOTE ROW
	// (a-note-is-a-timeline-row), not a column of the order. Nothing here branches on it. Trimmed when the row is
	// written; "" (or spaces alone) = nothing written down, and no note row.
	note string
	// The shipping receipt already uploaded to document_service, if any. Recorded as given — the id
	// is not verified, see OrderCreateRequest.receipt for why.
	receipt *sellingv1.OrderReceipt
	// The tracking number printed on that receipt, verbatim. "" = not known yet. From a draft it is what was typed on
	// the draft page — a draft does not keep one (the-draft-page-wears-the-order-form), but its Promote sends it.
	receiptCode string
	// The platform's two dates, unix seconds, 0 = none. The order date is REQUIRED (validate); the deadline is not.
	platformCreatedAt        int64
	platformShipmentDeadline int64

	// What the buyer paid on the platform — REQUIRED (validate, platform-total-is-required-at-finalize): it is the figure
	// settlement opens the account on. The order's own money (goods_cost, warehouse_fee, total_cost) is not here: it is
	// the take's and the warehouse's, frozen by placeOrder — no door supplies it.
	platformTotal int64
	// The marketplace's own id for this order, verbatim. Required by the request's validation
	// (an-order-ref-is-required-by-the-rpc); "" only on an order placed before that rule.
	orderExternalRefID string

	items []*sellingv1.OrderItem

	// Extra work to run INSIDE the order's transaction, once the order row exists. OrderCreate deletes the
	// draft it finishes here (order_draft_id), which is what makes "the order is written and the draft is gone" one atomic fact
	// rather than two writes with a gap between them.
	inTx func(tx *gorm.DB, order *selling_service_models.Order) error
}

// The requirements an order must meet, whichever door it came through. Each is stated as what is
// missing rather than as a code, because both callers report them to a person who has to go and fix
// exactly this.
var (
	errOrderNoShop     = errors.New("an order must say which shop it came through")
	errOrderNoCustomer = errors.New("an order must name a customer")
	errOrderNoItems    = errors.New("an order must have at least one line")
	errOrderBadLine    = errors.New("every line must name a product and a quantity of at least one")
	// platform-created-at-is-required-at-finalize: every order comes from a platform, so every order has the moment
	// its buyer ordered there — read off the same storefront page as the ref.
	errOrderNoPlatformDate = errors.New("an order must say when the buyer ordered it on the marketplace")
	// platform-total-is-required-at-finalize: settlement opens the order's account on this figure, so an order without
	// it could never be settled. Read off the storefront, like the date above.
	errOrderNoPlatformTotal = errors.New("an order must say what the buyer paid on the marketplace")
)

// validate is the one definition of a placeable order.
//
// It re-checks what proto validation already covers for OrderCreate rather than trusting it: a handler called
// directly — a unit test, a CLI command — gets no validation interceptor. (It was load-bearing while OrderDraftPromote
// existed: that request carried only a draft id, so none of the field rules ran.)
func (p *orderPlacement) validate() error {
	if p.shopID == 0 {
		return errOrderNoShop
	}

	// From #69 this id is what stock is deducted FROM, so an order that cannot say where its goods
	// come from is not an order the system can honour.
	if p.warehouseID == 0 {
		return errOrderNoWarehouse
	}

	if p.customerName == "" {
		return errOrderNoCustomer
	}

	// Checked HERE, the one definition every order meets, so a promoted draft cannot slip through without the date the
	// typed form is refused for (platform-created-at-is-required-at-finalize). A draft may hold it empty; an order may not.
	if p.platformCreatedAt <= 0 {
		return errOrderNoPlatformDate
	}

	// The same footing (platform-total-is-required-at-finalize): a draft's Promote sends the figure on its page, so a
	// draft still at 0 meets this rule exactly as a typed order does.
	if p.platformTotal <= 0 {
		return errOrderNoPlatformTotal
	}

	if len(p.items) == 0 {
		return errOrderNoItems
	}

	for _, item := range p.items {
		if item.GetProductId() == 0 || item.GetQuantity() == 0 {
			return errOrderBadLine
		}
	}

	return nil
}

// placeOrder writes an order, takes its stock, and announces it — the whole of what "placing" means.
//
// Extracted from OrderCreate for #194 so promote ran the same path; promote IS OrderCreate now. The
// behaviour is unchanged, including the parts that look odd and are not: the stock draw happens
// inside the still-uncommitted transaction, and the compensation tracks whether the pick was
// ATTEMPTED rather than whether it succeeded.
func (s *Service) placeOrder(
	ctx context.Context,
	p *orderPlacement,
) (*selling_service_models.Order, error) {
	err := p.validate()
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// ONE LINE PER PRODUCT, from here on (the-order-keeps-only-product-lines). A product named on two lines — once by
	// hand and once from a bundle, or on two draft rows mapped to it — is merged into one, its quantities summed, BEFORE
	// the owner lookup, the return-map check, the credit check and the take: the take draws a product once per order
	// and refuses one listed twice, and every money figure of the line is that one draw
	// (an-order-is-costed-at-what-leaves-the-shelf). The one merged line is what is stored. A line's price is not compared:
	// it is the take's, stamped below (an-order-line-carries-no-marketplace-price). Lines naming one product under two
	// skus or names are refused rather than merged — see mergeOrderLines.
	p.items, err = mergeOrderLines(p.items)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// The shop is checked BEFORE any stock moves. A bad shop is a rejected request, and rejecting it
	// after taking stock would mean compensating a draw that never needed to happen.
	shopOK, err := shopExists(s.db.WithContext(ctx), p.teamID, p.shopID)
	if err != nil {
		return nil, dbError(err)
	}

	if !shopOK {
		return nil, notFound()
	}

	// WHO OWNS EACH LINE, looked up ONCE — the owner's flow draws it as the first step after the request check, and
	// both the return-map check and the credit check below read this one answer. A lookup that fails REFUSES the
	// create (a-failed-owner-lookup-refuses-the-create): without it the order cannot tell a borrowed line from its own,
	// so it can neither demand the map nor name every creditor.
	owners, err := s.lineOwners(ctx, p.teamID, p.items)
	if err != nil {
		return nil, err
	}

	// EVERY BORROWED LINE HAS ITS RETURN MAP (a-borrowed-line-needs-its-map-at-create), checked here — the one rule
	// both doors share — so a promoted draft meets it exactly as a typed order does. Before anything is taken or
	// written; an own-only order reads nothing (an-own-line-never-touches-the-map).
	err = s.requireReturnMaps(ctx, p.teamID, p.items, owners)
	if err != nil {
		return nil, err
	}

	// CREDIT (#189). Every creditor this order would put in debt is checked BEFORE anything is
	// written: the fulfilling warehouse, and each team whose goods it sells. Any one over its limit
	// stops the order, naming itself so customer service can say why.
	//
	// Before the transaction — it is a read, and holding the order's row lock across another service's
	// call buys nothing. The staleness that allows is exactly the overshoot the `debt < limit` rule
	// already permits — see CheckCredit.
	block, err := s.credit.Check(ctx, p.teamID, orderCreditors(p.warehouseID, p.items, owners))
	if err != nil {
		return nil, dbError(err)
	}

	if block != nil {
		return nil, creditBlocked(block)
	}

	var (
		order selling_service_models.Order
		// Whether the stock draw was ATTEMPTED. See the compensation block below for why "attempted"
		// rather than "succeeded" is the right thing to track.
		picked bool
		// What the take drew for each product — the one answer every money figure of the order is frozen from.
		draw PickDraw
		// The warehouse's refusal of the fee, or the pricer being unreachable, kept AS IT CAME: priceWarehouseFee has
		// already shaped it for the form, so it must not be re-wrapped as an internal error on the way out.
		feeErr error
		// The take's own answer when it failed — kept apart from the database's errors for the same reason: a take
		// refused for short stock or a borrowed product below its reserve is the warehouse saying WHY, and the form can
		// only say it too if the code and the OrderTransactionRefusal detail reach it. See takeError.
		takeErr error
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		address := p.address

		order = selling_service_models.Order{
			TeamID: p.teamID,
			ShopID: p.shopID,
			// The warehouse this order ships from (#72), as chosen by whoever typed it — copied onto
			// the order, never looked up later, so it reads the same forever.
			WarehouseID:   p.warehouseID,
			Status:        orderStatusPending,
			CustomerName:  p.customerName,
			CustomerPhone: p.customerPhone,
			// Trimmed HERE, where both doors meet, so spaces alone are stored as none whichever way the order came in.
			BuyerUsername: strings.TrimSpace(p.buyerUsername),
			// FROZEN at order time: the names are copied, not resolved later, so this order reads the
			// same forever even after region_service renames or merges the desa (#118).
			ProvinsiCode:  address.GetProvinsiCode(),
			ProvinsiName:  address.GetProvinsiName(),
			KabupatenCode: address.GetKabupatenCode(),
			KabupatenName: address.GetKabupatenName(),
			KecamatanCode: address.GetKecamatanCode(),
			KecamatanName: address.GetKecamatanName(),
			DesaCode:      address.GetDesaCode(),
			DesaName:      address.GetDesaName(),
			KodePos:       address.GetKodePos(),
			AddressLine:   address.GetAddressLine(),
			ShippingCode:  p.shippingCode,
			// Getters all the way down: a nil receipt is an order with none, not a crash.
			ReceiptDocumentID: p.receipt.GetDocumentId(),
			ReceiptFilename:   p.receipt.GetFilename(),
			ReceiptMimeType:   p.receipt.GetMimeType(),
			// Verbatim — a courier's number is never reshaped.
			Receipt: p.receiptCode,
			// The platform's two dates, as read off the storefront. The deadline may be absent; the order date may not.
			PlatformCreatedAt:        timeOrNil(p.platformCreatedAt),
			PlatformShipmentDeadline: timeOrNil(p.platformShipmentDeadline),
			// `goods_cost`, `warehouse_fee` and `total_cost` are NOT written here: all three come from the take's draw,
			// which needs this row's id first. They are written below, after the pick, in this same transaction.
			PlatformTotal: p.platformTotal,
			// Verbatim, exactly as the person read it off the storefront — never trimmed into a
			// shape, never parsed.
			OrderExternalRefID: p.orderExternalRefID,
			// WHO CREATED IT, from the TOKEN and never from the request
			// (settlement #the-creator-is-read-from-the-token-at-placement): a client-supplied creator is
			// a client that can attribute somebody else's sales. 0 when the caller is unidentifiable.
			CreatedByUserID: eventActor(ctx),
			Items:           orderItemModels(p.items),
		}

		// THE HEADER FIRST, THE LINES AFTER THE PICK. A line's money is written ONCE, complete
		// (a-lines-money-is-frozen-at-finalize), and its `total` is the take's answer — so the lines wait for it
		// rather than being inserted short and patched. Held aside here and inserted below, in this same transaction.
		items := order.Items
		order.Items = nil

		createErr := tx.Create(&order).Error
		if createErr != nil {
			return createErr
		}

		// THE FIRST ROW ON ITS TIMELINE (order-timeline-logs-replaces-order-events), from the selling team that
		// placed it. Both doors into `orders` run this function, so a promoted draft gets the same opening row
		// as a typed-in order — recorded here rather than in the two handlers precisely so they cannot differ.
		//
		// `order.CreatedAt` is the order's own moment, stamped by GORM on the insert above, not a fresh
		// time.Now(): the row says when the order came into being, and the two must be the same instant or
		// the timeline disagrees with the header beside it.
		logs := []selling_service_models.OrderTimelineLog{{
			OrderID:   order.ID,
			Status:    orderStatusPending,
			From:      timelineFromSelling,
			ActorID:   eventActor(ctx),
			CreatedAt: order.CreatedAt,
		}}

		// THE FORM'S NOTE IS THE ORDER'S FIRST NOTE ROW (a-note-is-a-timeline-row): no status, from selling, by the
		// person placing the order, at the order's own moment — in this transaction, so an order and the instruction
		// typed with it exist together or not at all. Written in the same INSERT, after the placement row: same
		// instant, the next id, so a reader ordering by (created_at, id) sees the placement and then the note.
		note := strings.TrimSpace(p.note)
		if note != "" {
			logs = append(logs, selling_service_models.OrderTimelineLog{
				OrderID:   order.ID,
				Note:      note,
				From:      timelineFromSelling,
				ActorID:   eventActor(ctx),
				CreatedAt: order.CreatedAt,
			})
		}

		logErr := recordTimelineLogs(tx, logs)
		if logErr != nil {
			return logErr
		}

		// Whatever the caller needs done atomically with the order. For a draft's Promote this is the
		// draft's deletion: same service, same database, so it is one transaction and the "gap between
		// two writes" a cross-service split would have created never exists.
		if p.inTx != nil {
			hookErr := p.inTx(tx, &order)
			if hookErr != nil {
				return hookErr
			}
		}

		// THE STOCK, inside the order's still-uncommitted transaction (#149).
		//
		// The header insert comes first only to get the order's id, which is what the pick is recorded
		// under — the ref is what a later cancel names to put exactly this draw back (#70). The
		// GUARANTEE is unchanged and is what the owner chose: the pick must succeed before the order
		// is committed, so not enough stock means this transaction rolls back and NO ORDER EXISTS.
		// Writing the order first and deducting afterwards would leave a gap in which two orders
		// could be placed against the same unit.
		picked = true

		var pickErr error

		draw, pickErr = s.stock.Pick(ctx, p.teamID, order.WarehouseID, pickLines(p.items), stockRef(order.ID))
		if pickErr != nil {
			takeErr = pickErr

			return pickErr
		}

		// EVERY MONEY FIGURE OF THE ORDER FROM THE ONE DRAW (an-order-is-costed-at-what-leaves-the-shelf): what the units
		// that left the shelf cost — the owner's batches oldest first — never the shelf's average read before the take.
		//
		// Each line freezes what the take priced it at (inventory-computes-the-markup) — the owner's four money columns of
		// `order_items`: its unit cost; its unit cost with markup and its markup total, which on an own line are the unit
		// cost and 0; and its total — the goods plus, on a borrowed product, that product's own markup — all copied as
		// returned. The order applies nothing, and the total is what the product fee is posted from
		// (the-ledger-charges-the-frozen-line-total). A product the take named no draw for keeps a 0 cost (unknown — see
		// costKnown) and nil for the rest, never a 0 that reads as free. The cost comes from the WAREHOUSE, never the
		// request (#74): a client supplying it would be writing its own margin. A line carries no price of its own
		// (an-order-line-carries-no-marketplace-price): nothing from either door's request is money.
		for i := range items {
			items[i].OrderID = order.ID

			line, drawn := draw[items[i].ProductID]
			if drawn {
				total := line.Total
				withMarkup := line.UnitCostWithMarkup
				markup := line.MarkupTotal
				items[i].UnitCost = int64(math.Round(line.UnitCost))
				items[i].Total = &total
				items[i].UnitCostWithMarkup = &withMarkup
				items[i].MarkupTotal = &markup
			}
		}

		order.GoodsCost = orderGoodsCost(p.items, draw)

		// THE WAREHOUSE FEE, priced on that goods_cost and frozen (the-fee-is-priced-on-goods-cost,
		// the-flat-rate-is-dropped-last step 3) — so a borrowed line's markup is in the basis, as the goods cost the
		// seller. AFTER the take and INSIDE this transaction, because its basis is the draw and the draw exists only once
		// the take has answered. The fee is warehouse_service's to compute, never this service's
		// (warehouse-prices-balance-records), so it is asked here rather than worked out from a rate read beforehand.
		//
		// A warehouse with no rate (a-warehouse-with-no-rate-takes-no-orders), or a pricer nobody can reach, fails this
		// transaction like any failed step, and the compensation below gives the take back — the owner's own flow. The
		// order form refuses such a warehouse before Create, so this is the rare path, not the usual one.
		warehouseFee, priceErr := s.priceWarehouseFee(ctx, p.teamID, p.warehouseID, order.GoodsCost)
		if priceErr != nil {
			feeErr = priceErr

			return priceErr
		}

		order.WarehouseFee = warehouseFee
		order.TotalCost = orderTotalCost(order.GoodsCost, warehouseFee)

		// THE HEADER'S MONEY, written now that it is known — in the transaction that inserted the row, so no reader ever
		// sees the order without it. A nil fee only on a service built without a pricer.
		moneyErr := tx.Model(&order).UpdateColumns(map[string]any{
			"goods_cost":    order.GoodsCost,
			"warehouse_fee": order.WarehouseFee,
			"total_cost":    order.TotalCost,
		}).Error
		if moneyErr != nil {
			return moneyErr
		}

		itemsErr := tx.Create(&items).Error
		if itemsErr != nil {
			return itemsErr
		}

		order.Items = items

		return nil
	})
	if err != nil {
		// COMPENSATION (#149). The pick runs against another service and commits on its own; if this
		// transaction then failed, stock has left for an order that does not exist. There is no
		// rollback that reaches across both, so the draw is UNDONE explicitly.
		//
		// `picked` is set before the call rather than after, deliberately: a Pick that fails midway
		// takes nothing (it is one transaction there), but a Pick whose result never reached us — a
		// timeout, a panic — may well have committed. Compensating a draw that never happened is a
		// harmless NotFound; failing to compensate one that did is stock lost from the building.
		if picked {
			returnErr := s.stock.Return(ctx, p.teamID, order.WarehouseID, stockRef(order.ID))
			if returnErr != nil {
				// The order failed AND its stock could not be put back. Say both, because the second
				// is the one someone has to fix by hand, and a message naming only the first would
				// send them looking in the wrong place.
				return nil, connect.NewError(connect.CodeInternal,
					errors.New("the order failed and its stock could not be returned ("+
						stockRef(order.ID)+"): "+returnErr.Error()))
			}
		}

		if feeErr != nil {
			return nil, feeErr
		}

		if takeErr != nil {
			return nil, takeError(takeErr)
		}

		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	// THE ORDER IS COMMITTED. Announce it (#153) so revenue can record what it was expected to make.
	//
	// After the commit, never inside it. Publishing inside would mean a rolled-back order that revenue
	// has already recorded — a phantom nothing would ever correct. The cost of doing it here is the
	// opposite failure: a crash between commit and publish leaves an order with no revenue row. That is
	// the better half of the trade, and only because it is REPAIRABLE — the order still holds every
	// figure the event carries, and RevenueRecord refuses duplicates on order_id, so a backfill can be
	// run safely at any time.
	//
	// A publish failure does NOT fail the order. Revenue is downstream: a shop must be able to keep
	// selling while the revenue service, or the broker, is down. It is logged loudly instead, because
	// the alternative — swallowing it — is how a month-end report quietly goes wrong.
	//
	// EventId is DERIVED from the order, never a fresh UUID: a redelivery and a replay are the same
	// logical fact and must collide, or a consumer counts the order twice. OccurredAtUnix is the
	// order's own CreatedAt — the moment the order came into being — not time.Now() here, so a
	// backfill run next month still files it in the day it happened
	// (guidelines/event-guideline.md #1, #2).
	orderRef := strconv.FormatUint(order.ID, 10)

	publishErr := s.events(ctx, eventIdentity(ctx), &eventsv1.Event{
		EventId:     "order-placed:" + orderRef,
		OccurredAt:  timestamppb.New(order.CreatedAt),
		AggregateId: "order:" + orderRef,
		Message: &eventsv1.Event_OrderPlaced{
			OrderPlaced: &eventsv1.OrderPlaced{
				TeamId:      order.TeamID,
				OrderId:     order.ID,
				GoodsCost:   order.GoodsCost,
				CostKnown:   costKnown(order.Items, draw),
				WarehouseId: order.WarehouseID,
				Lines:       s.placedLines(ctx, order.TeamID, order.Items),
				// WHO PLACED IT. The ledger records a person behind every movement, and the two fees
				// this event causes are posted by a consumer with no request context to read one from
				// (every-entry-names-who-posted-it).
				ActorId: eventActor(ctx),
				// What settlement opens the order's account from — the order never calls settlement
				// (settlement-opens-the-sale-from-the-order-event).
				ShopId:        order.ShopID,
				PlatformTotal: order.PlatformTotal,
				// The fee as frozen above — liability posts this number and reads no rate of its own
				// (the-event-carries-the-warehouse-fee).
				WarehouseFee: order.WarehouseFee,
			},
		},
	})
	if publishErr != nil {
		slog.ErrorContext(ctx, "order placed but its OrderPlaced event was not published — "+
			"its revenue row must be backfilled",
			"order_id", order.ID,
			"team_id", order.TeamID,
			"error", publishErr,
		)
	}

	return &order, nil
}

// orderGoodsCost is the order's `goods_cost`: Σ the lines' frozen `total` — the value of the units that left the shelf
// (an-order-is-costed-at-what-leaves-the-shelf) plus, on another team's product, that product's own markup — rounded
// ONCE, to the whole rupiah the column holds. What the goods cost the SELLER (the-cross-charge-lives-on-the-line): a
// borrowed line is owed to its owner at its total (the-product-fee-is-the-line-total), so it counts at that here too;
// on an own line the total is the drawn cost. A product the take named no draw for adds 0, which is why a goods_cost of
// 0 reads as UNKNOWN rather than free (see costKnown). It is also the basis the warehouse prices its fee on
// (the-fee-is-priced-on-goods-cost) — one figure, so the two cannot be two sums.
func orderGoodsCost(items []*sellingv1.OrderItem, draw PickDraw) int64 {
	var total float64

	// In the order's own product order, so the float sum comes out the same every time.
	for _, id := range orderProductIDs(items) {
		total += draw[id].Total
	}

	return int64(math.Round(total))
}

// orderTotalCost is the order's `total_cost`: goods_cost + the warehouse fee — the owner's "goods + warehouse fee", what
// the order cost the seller. Unrounded, like the fee. A fee never priced (a service built without a pricer) adds 0.
func orderTotalCost(goodsCost int64, warehouseFee *float64) float64 {
	total := float64(goodsCost)

	if warehouseFee != nil {
		total += *warehouseFee
	}

	return total
}

// priceWarehouseFee is the fee the fulfilling warehouse charges for goods costing `goodsCost`, or nil when this service
// was built without a pricer (see Service.fees).
//
// A REFUSAL PASSES THROUGH AS IT CAME: the pricer's FailedPrecondition already names the warehouse with no rate, which
// is exactly what the order form shows (a-warehouse-with-no-rate-takes-no-orders). Anything else is the pricer being
// unreachable, and an order is not placed at a fee nobody could compute.
//
// ⚠ A COST THE TAKE DID NOT ANSWER IS PRICED AS 0, so a percentage warehouse charges its floor on such an order. The
// fee's basis is the goods' cost by decision (the-fee-is-priced-on-goods-cost); an unknown cost has no better basis.
func (s *Service) priceWarehouseFee(ctx context.Context, teamID, warehouseID uint64, goodsCost int64) (*float64, error) {
	if s.fees == nil {
		return nil, nil
	}

	fee, err := s.fees.Price(ctx, teamID, warehouseID, float64(goodsCost))
	if err != nil {
		var refusal *connect.Error
		if errors.As(err, &refusal) && refusal.Code() == connect.CodeFailedPrecondition {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New(refusal.Message()))
		}

		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("the warehouse fee could not be priced: %w", err))
	}

	return &fee, nil
}

// takeError is what the caller hears when the take failed.
//
// THE TAKE'S OWN ANSWER PASSES THROUGH AS IT CAME — its code, its message and its details. A refusal (not enough stock,
// a borrowed product that is private or below its owner's reserve, a used key) is a Connect error carrying an
// OrderTransactionRefusal detail with the reason and every line it names (a-refusal-names-its-reason-and-every-line),
// and that detail is exactly what the order form needs to say WHY. Wrapped as a database error it reached the form as
// Internal, and a person who could fix the order by lowering one quantity was told the system was broken.
//
// selling reads nothing in the detail and imports nothing of inventory's: it is the warehouse's sentence, carried. Only
// an error that is not a Connect error at all — the take never answered in its own terms — is this service's Internal.
func takeError(err error) error {
	var answered *connect.Error
	if errors.As(err, &answered) {
		return answered
	}

	return dbError(err)
}

// costKnown reports whether EVERY line's cost was actually known (#74/#153) — whether the take answered a draw for it.
//
// A product the take named no draw for is absent from the map and lands on its line as 0, which is
// indistinguishable from "free" once it is written down. So the distinction is computed here, while
// the map is still in hand, and travels with the event as its own field.
//
// ALL lines, not some. One unknown line understates the order's goods_cost, which overstates its margin —
// and a margin that is wrong is wrong however few lines caused it. A "mostly known" cost is not a
// thing a report can use.
func costKnown(items []selling_service_models.OrderItem, draw PickDraw) bool {
	for i := range items {
		_, known := draw[items[i].ProductID]
		if !known {
			return false
		}
	}

	return true
}

// placedLines is what liability needs to charge the PRODUCT FEE (#186): per line, who owns the
// goods and the line's frozen total (the-ledger-charges-the-frozen-line-total).
//
// The owner is resolved HERE, at placement, and travels on the event — the same choice the money
// already makes. A consumer that read the catalogue when it processed the event would answer "who
// owns this?" as of THEN, so a product transferred to another team next month would rewrite who was
// owed for a sale that happened today.
//
// ⚠ A FAILED LOOKUP DOES NOT FAIL THE ORDER. The order is already committed by the time this runs,
// and liability is downstream exactly as revenue is: a shop must keep selling while the catalogue,
// or the ledger, is having a bad day. An unresolved owner rides as 0 and liability treats it as
// "nobody to pay" — a gap the reconciliation report (#187) is built to find, rather than a sale
// nobody could make.
func (s *Service) placedLines(
	ctx context.Context,
	teamID uint64,
	items []selling_service_models.OrderItem,
) []*eventsv1.OrderPlacedLine {
	ids := make([]uint64, 0, len(items))
	seen := map[uint64]bool{}

	for i := range items {
		id := items[i].ProductID
		if id == 0 || seen[id] {
			continue
		}

		seen[id] = true

		ids = append(ids, id)
	}

	owners := map[uint64]ProductSnapshot{}

	if s.catalog != nil && len(ids) > 0 {
		resolved, err := s.catalog.Snapshots(ctx, teamID, ids)
		if err != nil {
			slog.ErrorContext(ctx, "order placed but the product owners could not be resolved — "+
				"liability will see no product fees for it",
				"team_id", teamID,
				"error", err,
			)
		} else {
			owners = resolved
		}
	}

	lines := make([]*eventsv1.OrderPlacedLine, 0, len(items))

	for i := range items {
		// The line's FROZEN total, as stored — what liability posts the product fee from. 0 when the line froze none.
		var total float64
		if items[i].Total != nil {
			total = *items[i].Total
		}

		lines = append(lines, &eventsv1.OrderPlacedLine{
			ProductId: items[i].ProductID,
			// 0 when unresolved, which liability reads as "nobody to pay".
			OwningTeamId: owners[items[i].ProductID].TeamID,
			Quantity:     items[i].Quantity,
			UnitCost:     items[i].UnitCost,
			Total:        total,
		})
	}

	return lines
}

// lineOwners resolves each product on the order to its owning team — the lookup the owner's create flow draws before
// the debt check, read once and shared by the return-map check and the credit check.
//
// ⚠ A FAILED LOOKUP REFUSES THE CREATE (a-failed-owner-lookup-refuses-the-create). It used to fail open, on the
// argument that a catalogue outage must not stop every sale; the owner decided the other way, and the return map
// settles it regardless — an order that cannot tell a borrowed line from its own cannot check that every borrowed line
// is mapped (a-borrowed-line-needs-its-map-at-create). Unavailable, because trying again is the remedy.
//
// An id that resolves to nothing is ABSENT from the map — a product nobody owns, which neither check counts as
// borrowed. A service built without a catalogue (a unit test about something else) knows no owners at all.
//
// placedLines resolves the owners a second time, after the commit, and that is not duplication worth removing: it runs
// once the order exists and must never fail it, so its failure is logged and the owner rides as 0. Sharing this map
// would force one of those two rules onto the other.
func (s *Service) lineOwners(
	ctx context.Context,
	teamID uint64,
	items []*sellingv1.OrderItem,
) (map[uint64]ProductSnapshot, error) {
	ids := orderProductIDs(items)

	// nil, not empty: "no catalogue to ask", which orderCreditors tells apart from "asked, and none resolved".
	if s.catalog == nil || len(ids) == 0 {
		return nil, nil
	}

	owners, err := s.catalog.Snapshots(ctx, teamID, ids)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("the products' owners could not be looked up — the order was not placed, try again: %w", err))
	}

	return owners, nil
}

// orderCreditors is every team this order would put the buying team in debt to: the warehouse that
// will fulfil it, plus each team owning a product on it — read off the one owners lookup (lineOwners).
//
// An owner that did not resolve rides as 0 and is not checked: a product nobody owns is owed to nobody.
func orderCreditors(
	warehouseID uint64,
	items []*sellingv1.OrderItem,
	owners map[uint64]ProductSnapshot,
) []uint64 {
	creditors := []uint64{warehouseID}

	ids := orderProductIDs(items)

	if owners == nil {
		return creditors
	}

	for _, id := range ids {
		creditors = append(creditors, owners[id].TeamID)
	}

	return creditors
}

// creditBlocked turns the refusal into the message the ORDER FORM shows (#189).
//
// FAILED_PRECONDITION, not PERMISSION_DENIED: the caller is allowed to place orders, and the state of
// the world is what refuses. It is also not a retry — retrying changes nothing until somebody pays.
//
// The creditor, the debt and the limit all travel in the text because the person hitting this is
// CUSTOMER SERVICE, who never sees the Liability screens and cannot go and look the numbers up.
func creditBlocked(block *CreditBlock) error {
	return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf(
		"credit limit reached with team %d: %d owed of a %d limit — settle before ordering again",
		block.CreditorTeamID, block.Debt, block.Limit,
	))
}
