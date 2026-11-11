package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
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
	// The courier — a shipment channel id, opaque here (shipment-channel-is-an-id-into-shipment-service). REQUIRED
	// (validate, no-order-without-a-courier): a draft may arrive without one, and the person picks it on the form.
	shipmentChannelID uint64
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
	//
	// A double as typed or read; placeOrder freezes it EXACT as it writes the order row (the-backend-never-rounds-money),
	// and settlement's `initial_total` carries that same figure.
	platformTotal float64
	// The marketplace's own id for this order, verbatim. Required by the request's validation
	// (an-order-ref-is-required-by-the-rpc); "" only on an order placed before that rule.
	orderExternalRefID string

	// The submit's own key (the-frontend-mints-the-idempotency-key), stored on the order. REQUIRED, never `order:…`
	// (validate). Already refused by OrderCreate when an order holds it; the unique index catches the same-second twin.
	idempotencyKey string

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
	// no-order-without-a-courier: an order with no courier cannot be handed over. A draft the app could not convert
	// arrives without one, and the person picks it on the form — or root adds the missing channel first.
	errOrderNoCourier = errors.New("an order must say which courier carries it")
	errOrderNoItems   = errors.New("an order must have at least one line")
	errOrderBadLine   = errors.New("every line must name a product and a quantity of at least one")
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
	keyErr := keyShapeError(p.idempotencyKey)
	if keyErr != nil {
		return keyErr
	}

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

	// Here, the one definition every order meets, so a promoted draft without a courier is refused exactly as a typed
	// order is (no-order-without-a-courier). Only presence: the id is shipment_service's and opaque to this service.
	if p.shipmentChannelID == 0 {
		return errOrderNoCourier
	}

	// Checked HERE, the one definition every order meets, so a promoted draft cannot slip through without the date the
	// typed form is refused for (platform-created-at-is-required-at-finalize). A draft may hold it empty; an order may not.
	if p.platformCreatedAt <= 0 {
		return errOrderNoPlatformDate
	}

	// The same footing (platform-total-is-required-at-finalize): a draft's Promote sends the figure on its page, so a
	// draft still at 0 meets this rule exactly as a typed order does.
	// Judged on the exact figure (the-backend-never-rounds-money): it must be finite and above 0 — float dust below 4
	// places is as missing as 0. NaN and the infinities are refused too: the wire's double.finite does not reach a
	// direct caller.
	if !san_money.Positive(p.platformTotal) {
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

// placeOrder takes an order's stock, writes the order, and announces it — the whole of what "placing" means.
//
// THE TAKE COMES FIRST, under the order's key K, before the order row and outside its transaction (backlog #10 slice
// 3, the-compensation-event-is-inventory-tx-cancel). Any failure once the take was called — the take itself, the fee,
// the draft, the database, a person leaving — releases the take by K, directly and then by InventoryTxCancel
// (the-release-is-direct-then-the-event), EXCEPT a take refused because K is already used, which is another submit's
// live take and is never released (a-used-key-is-never-cancelled). Promote IS OrderCreate (#194), so both doors run this.
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
	// product codes or names are refused rather than merged — see mergeOrderLines.
	p.items, err = mergeOrderLines(p.items)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// The shop is checked BEFORE any stock moves. A bad shop is a rejected request, and rejecting it
	// after taking stock would mean compensating a draw that never needed to happen. It is the write gate
	// (a-write-needs-a-grant-or-a-manager): this team's, open, and the caller granted it or running the team — so a
	// draft's Promote, which is this same door, meets it too.
	err = s.refuseShopWrite(ctx, p.teamID, p.shopID)
	if err != nil {
		return nil, err
	}

	// THE TEAM HAS A RETURN WAREHOUSE (create-refuses-a-team-with-no-return-warehouse, rollout step 3, switched on
	// 2026-11-11): with the request's own checks — after the shop gate, so a shop that is not the caller's stays NotFound
	// and discloses nothing — and before the owner lookup, the credit check and the take, so a refused team costs one
	// indexed read and moves nothing. It reads this service's own table, never another service. Both doors meet it: the
	// typed form and a draft's Promote are this one function. A draft PUSHED by the app is not an order
	// (OrderDraftPush), so it is never refused here — its Promote is.
	err = s.requireReturnWarehouseToOrder(ctx, p.teamID)
	if err != nil {
		return nil, err
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

	// THE STOCK TAKE, BEFORE THE ORDER ROW AND OUTSIDE ITS TRANSACTION (backlog #10 slice 3) — after the key check, the
	// owner lookup, the return maps and the credit check, so a refused order never takes anything. Filed under the
	// order's own key K (the-frontend-mints-the-idempotency-key, every-release-goes-by-the-key): the row does not exist
	// yet, so K is the only name the take can have, and it is what the release names. No selling lock is held across the
	// inventory call any more.
	//
	// It runs under the REQUEST's context with no deadline of its own (no-answer-is-only-a-lost-connection): a slow
	// warehouse keeps the person waiting; a person who leaves cancels it, and the compensation below still runs.
	take, err := s.stock.Pick(ctx, p.teamID, p.warehouseID, pickLines(p.items), p.idempotencyKey)
	if err != nil {
		// A KEY ALREADY USED IS NEVER COMPENSATED (a-used-key-is-never-cancelled): the key is another submit's live take,
		// and only the order that owns a key may release it. The order fails with the refusal, as it came.
		if isKeyUsedRefusal(err) {
			return nil, takeError(err)
		}

		// Any other failure — a refusal, an error, a context cancelled mid-call — may still have committed on the
		// inventory side (an answer lost on the way back), so the take is released by K all the same. A release of a key
		// nothing was taken under claims it with none, so a take that lands late is refused.
		s.compensateTake(ctx, p, "the stock take failed: "+err.Error())

		return nil, takeError(err)
	}

	draw := take.Draw

	var (
		order selling_service_models.Order
		// The warehouse's refusal of the fee, or the pricer being unreachable, kept AS IT CAME: priceWarehouseFee has
		// already shaped it for the form, so it must not be re-wrapped as an internal error on the way out.
		feeErr error
		// The insert met orders_idempotency_key_idx. Unreachable in practice since the take runs first — a twin of this
		// key is refused KEY_USED at the take — but kept as the backstop it was (the-idempotency-key-is-unique).
		keyTaken bool
		// The transaction's body ran to the end and only its COMMIT was left — an error from here on may come from a
		// commit that landed (backlog #10c), so the order is looked for before anything is released.
		reachedCommit bool
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// THE SHOP IS STILL OPEN, read again under the row's share lock — a close that landed after the gate above is
		// seen here, and refused like any failed step (the take is compensated below).
		shopErr := refuseClosedShopInTx(tx, p.teamID, p.shopID)
		if shopErr != nil {
			return shopErr
		}

		order = selling_service_models.Order{
			TeamID: p.teamID,
			ShopID: p.shopID,
			// The warehouse this order ships from (#72), as chosen by whoever typed it — copied onto
			// the order, never looked up later, so it reads the same forever.
			WarehouseID: p.warehouseID,
			Status:      orderStatusPending,
			// Trimmed HERE, where both doors meet, so spaces alone are stored as none whichever way the order came in.
			BuyerUsername: strings.TrimSpace(p.buyerUsername),
			// The courier's id, as picked — nothing else about the channel (the-channel-name-is-not-frozen).
			ShipmentChannelID: p.shipmentChannelID,
			// Getters all the way down: a nil receipt is an order with none, not a crash.
			ReceiptDocumentID: p.receipt.GetDocumentId(),
			ReceiptFilename:   p.receipt.GetFilename(),
			ReceiptMimeType:   p.receipt.GetMimeType(),
			// Verbatim — a courier's number is never reshaped.
			Receipt: p.receiptCode,
			// The platform's two dates, as read off the storefront. The deadline may be absent; the order date may not.
			PlatformCreatedAt:        timeOrNil(p.platformCreatedAt),
			PlatformShipmentDeadline: timeOrNil(p.platformShipmentDeadline),
			// `goods_cost` is the take's draw, known before the row is written. `warehouse_fee` and `total_cost` are
			// priced below, in this same transaction.
			GoodsCost: orderGoodsCost(p.items, draw),
			// FROZEN HERE, exact as typed (the-backend-never-rounds-money) — the event and the account read the row.
			PlatformTotal: p.platformTotal,
			// Verbatim, exactly as the person read it off the storefront — never trimmed into a
			// shape, never parsed.
			OrderExternalRefID: p.orderExternalRefID,
			// The submit's key, as sent (the-order-stores-its-idempotency-key) — the key the take above is filed under.
			IdempotencyKey: p.idempotencyKey,
			// The inventory transaction the take wrote (the-placement-page-reads-racks-by-transaction-id).
			TransactionID: transactionIDOrNil(take.TransactionID),
			// WHO CREATED IT, from the TOKEN and never from the request
			// (settlement #the-creator-is-read-from-the-token-at-placement): a client-supplied creator is
			// a client that can attribute somebody else's sales. 0 when the caller is unidentifiable.
			CreatedByUserID: eventActor(ctx),
			// ...and whether they placed it from outside the team (an-override-is-stamped-in-every-service).
			IsOverride: eventOverride(ctx),
			Items:      orderItemModels(p.items),
		}

		// THE HEADER FIRST, THE LINES LAST. A line's money is written ONCE, complete (a-lines-money-is-frozen-at-finalize):
		// held aside here, stamped from the draw, and inserted at the end of this same transaction.
		items := order.Items
		order.Items = nil

		// THE BACKSTOP (the-idempotency-key-is-unique). A twin submit of this key is refused KEY_USED at the take
		// above, before it gets here; the unique index stays the last word.
		createErr := tx.Create(&order).Error
		if createErr != nil {
			if isUniqueViolation(createErr) {
				keyTaken = true
			}

			return createErr
		}

		// THE ORDER'S ONE ADDRESS ROW, in its own transaction (one-address-per-order-and-per-draft) — so an order without
		// one is never reachable. NAMES ONLY (an-address-is-plain-names): the picker's region codes are discarded here, and
		// the names are frozen so the order reads the same after a desa is renamed upstream.
		address := selling_service_models.OrderAddress{
			OrderID:       order.ID,
			CustomerName:  p.customerName,
			CustomerPhone: p.customerPhone,
			ProvinsiName:  p.address.GetProvinsiName(),
			KabupatenName: p.address.GetKabupatenName(),
			KecamatanName: p.address.GetKecamatanName(),
			DesaName:      p.address.GetDesaName(),
			PostalCode:    p.address.GetKodePos(),
			AddressLine:   p.address.GetAddressLine(),
		}

		addressErr := tx.Create(&address).Error
		if addressErr != nil {
			return addressErr
		}

		order.Address = &address

		// THE FIRST ROW ON ITS TIMELINE (order-timeline-logs-replaces-order-events), from the selling team that
		// placed it. Both doors into `orders` run this function, so a promoted draft gets the same opening row
		// as a typed-in order — recorded here rather than in the two handlers precisely so they cannot differ.
		//
		// `order.CreatedAt` is the order's own moment, stamped by GORM on the insert above, not a fresh
		// time.Now(): the row says when the order came into being, and the two must be the same instant or
		// the timeline disagrees with the header beside it.
		logs := []selling_service_models.OrderTimelineLog{{
			OrderID:    order.ID,
			Status:     orderStatusPending,
			From:       timelineFromSelling,
			ActorID:    eventActor(ctx),
			IsOverride: eventOverride(ctx),
			CreatedAt:  order.CreatedAt,
		}}

		// THE FORM'S NOTE IS THE ORDER'S FIRST NOTE ROW (a-note-is-a-timeline-row): no status, from selling, by the
		// person placing the order, at the order's own moment — in this transaction, so an order and the instruction
		// typed with it exist together or not at all. Written in the same INSERT, after the placement row: same
		// instant, the next id, so a reader ordering by (created_at, id) sees the placement and then the note.
		note := strings.TrimSpace(p.note)
		if note != "" {
			logs = append(logs, selling_service_models.OrderTimelineLog{
				OrderID:    order.ID,
				Note:       note,
				From:       timelineFromSelling,
				ActorID:    eventActor(ctx),
				IsOverride: eventOverride(ctx),
				CreatedAt:  order.CreatedAt,
			})
		}

		logErr := recordTimelineLogs(tx, logs)
		if logErr != nil {
			return logErr
		}

		// Whatever the caller needs done atomically with the order. For a draft's Promote this is the
		// draft's deletion: same service, same database, so it is one transaction and the "gap between
		// two writes" a cross-service split would have created never exists. A delete that finds the draft gone
		// fails the order — after the take, so the compensation below gives the stock back.
		if p.inTx != nil {
			hookErr := p.inTx(tx, &order)
			if hookErr != nil {
				return hookErr
			}
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
				// Frozen here exact, as the take priced it (the-backend-never-rounds-money).
				items[i].UnitCost = line.UnitCost
				items[i].Total = &total
				items[i].UnitCostWithMarkup = &withMarkup
				items[i].MarkupTotal = &markup
			}
		}

		// THE WAREHOUSE FEE, priced on that goods_cost and frozen (the-fee-is-priced-on-goods-cost,
		// the-flat-rate-is-dropped-last step 3) — so a borrowed line's markup is in the basis, as the goods cost the
		// seller. The fee is warehouse_service's to compute, never this service's (warehouse-prices-balance-records).
		//
		// A warehouse with no rate (a-warehouse-with-no-rate-takes-no-orders), or a pricer nobody can reach, fails this
		// transaction like any failed step, and the compensation below gives the take back. The order form refuses such a
		// warehouse before Create, so this is the rare path, not the usual one.
		warehouseFee, priceErr := s.priceWarehouseFee(ctx, p.teamID, p.warehouseID, order.GoodsCost)
		if priceErr != nil {
			feeErr = priceErr

			return priceErr
		}

		order.WarehouseFee = warehouseFee
		order.TotalCost = orderTotalCost(order.GoodsCost, warehouseFee)

		// THE FEE AND THE TOTAL, written now that they are known — in the transaction that inserted the row, so no reader
		// ever sees the order without them. A nil fee only on a service built without a pricer.
		moneyErr := tx.Model(&order).UpdateColumns(map[string]any{
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

		// Every step ran: from here the only thing left is the COMMIT, and a commit that reports an error may still have
		// landed (an answer lost on the way back). Recorded so the failure below knows to look before it releases.
		reachedCommit = true

		return nil
	})
	if s.orderCommitResult != nil {
		err = s.orderCommitResult(err)
	}

	if err != nil && reachedCommit {
		// THE COMMIT MAY HAVE LANDED (backlog #10c). The error came at or after the commit, so the order may exist — and
		// releasing its take then would leave a live order with no stock behind it. A FRESH read by K, outside the failed
		// transaction, decides: the order is there → it was placed, nothing is released or announced as cancelled, and it
		// is answered as placed; it is not → it never committed, and the take is compensated as any failure is.
		placed, readErr := s.placedOrderByKey(ctx, p.idempotencyKey)
		if readErr != nil {
			// NOT KNOWN EITHER WAY, so nothing is released: a release under an order that did commit is stock gone from a
			// live order, which nothing would find; a take left standing under an order that did not is named here, by K.
			slog.ErrorContext(ctx, "STOCK MAY STILL BE TAKEN: an order's commit reported an error and the re-read by its "+
				"key failed too — check whether the order exists, and release the key by hand if it does not "+
				"(OrderTransactionRelease)",
				"idempotency_key", p.idempotencyKey,
				"team_id", p.teamID,
				"warehouse_id", p.warehouseID,
				"commit_error", err,
				"read_error", readErr,
			)

			return nil, connect.NewError(connect.CodeUnavailable, errOrderOutcomeUnknown)
		}

		if placed != nil {
			slog.WarnContext(ctx, "an order's commit reported an error but the order is there — answered as placed",
				"order_id", placed.ID,
				"idempotency_key", p.idempotencyKey,
				"commit_error", err,
			)

			order = *placed
			err = nil
		}
	}

	if err != nil {
		// COMPENSATION (the-compensation-event-is-inventory-tx-cancel, the-release-is-direct-then-the-event). The take
		// committed on its own before this transaction began; this transaction failing — the fee refused, the draft
		// already promoted, the database, the person leaving — means stock left for an order that does not exist. There
		// is no rollback that reaches across both, so the take is RELEASED by K: directly first, then by event.
		s.compensateTake(ctx, p, "the order was not written after its stock take: "+err.Error())

		if keyTaken {
			return nil, keyUsed()
		}

		if feeErr != nil {
			return nil, feeErr
		}

		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		// A step's own answer — the draft already turned into an order (Aborted) — reaches the caller as it came.
		var answered *connect.Error
		if errors.As(err, &answered) {
			return nil, answered
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
				// ...and whether they placed it from outside the team — the answer `orders.is_override` was stamped with
				// above, so the fees and the opening row a consumer posts for this actor say so too
				// (an-override-is-stamped-in-every-service).
				ActorIsOverride: eventOverride(ctx),
				// What settlement opens the order's account from — the order never calls settlement
				// (settlement-opens-the-sale-from-the-order-event).
				ShopId:        order.ShopID,
				PlatformTotal: order.PlatformTotal,
				// The fee as frozen above — liability posts this number and reads no rate of its own
				// (the-event-carries-the-warehouse-fee).
				WarehouseFee: order.WarehouseFee,
				// The key the order and its take are filed under, and the take's inventory transaction.
				IdempotencyKey: order.IdempotencyKey,
				TransactionId:  take.TransactionID,
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
// (an-order-is-costed-at-what-leaves-the-shelf) plus, on another team's product, that product's own markup — EXACT, never
// rounded (the-backend-never-rounds-money; a double since 00042). What the goods cost the SELLER (the-cross-charge-lives-on-the-line): a
// borrowed line is owed to its owner at its total (the-product-fee-is-the-line-total), so it counts at that here too;
// on an own line the total is the drawn cost. A product the take named no draw for adds 0, which is why a goods_cost of
// 0 reads as UNKNOWN rather than free (see costKnown). It is also the basis the warehouse prices its fee on
// (the-fee-is-priced-on-goods-cost) — one figure, so the two cannot be two sums.
func orderGoodsCost(items []*sellingv1.OrderItem, draw PickDraw) float64 {
	var total float64

	// In the order's own product order, so the float sum comes out the same every time.
	for _, id := range orderProductIDs(items) {
		total += draw[id].Total
	}

	return total
}

// orderTotalCost is the order's `total_cost`: goods_cost + the warehouse fee — the owner's "goods + warehouse fee", what
// the order cost the seller. Unrounded, like the fee. A fee never priced (a service built without a pricer) adds 0.
func orderTotalCost(goodsCost float64, warehouseFee *float64) float64 {
	total := goodsCost

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
func (s *Service) priceWarehouseFee(ctx context.Context, teamID, warehouseID uint64, goodsCost float64) (*float64, error) {
	if s.fees == nil {
		return nil, nil
	}

	fee, err := s.fees.Price(ctx, teamID, warehouseID, goodsCost)
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
		"credit limit reached with team %d: %s owed of a %s limit — settle before ordering again",
		block.CreditorTeamID, san_money.Text(block.Debt), san_money.Text(block.Limit),
	))
}

// errOrderNoReturnWarehouse is create-refuses-a-team-with-no-return-warehouse's refusal, after the team's name: the
// return warehouse is not set, and where to set it (the flow's "set the return warehouse first").
var errOrderNoReturnWarehouse = errors.New("has no return warehouse set — set it on Settings › Return Warehouse " +
	"before creating an order")

// requireReturnWarehouseToOrder refuses an order for a team with no `team_return_configurations` row
// (create-refuses-a-team-with-no-return-warehouse): nobody could accept its return (only-the-return-warehouse-accepts-a-
// return). FAILED_PRECONDITION, as creditBlocked: the caller may order, the team's settings are what refuse. The message
// names the team (TeamNamer, "team #<id>" without one), since the person reading it is customer service, who fixes it
// by asking a manager to set the card.
//
// BEFORE the transaction, as the decision places it — and safe there: a row is never deleted (TeamReturnConfigurationSet
// only inserts or moves it to another warehouse, and nothing else writes the table), so the answer read here cannot turn
// false before the order commits. A warehouse changed in between does not matter: the order stores none, and the return
// reads the row when it happens (the-return-warehouse-is-read-when-the-return-happens).
func (s *Service) requireReturnWarehouseToOrder(ctx context.Context, teamID uint64) error {
	returnWarehouse, err := returnWarehouseOf(s.db.WithContext(ctx), teamID)
	if err != nil {
		return dbError(err)
	}

	if returnWarehouse != 0 {
		return nil
	}

	return connect.NewError(connect.CodeFailedPrecondition,
		fmt.Errorf("%s %w", s.teamName(ctx, teamID, "team"), errOrderNoReturnWarehouse))
}
