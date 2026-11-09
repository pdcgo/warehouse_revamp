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
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The return accept's refusals, each a sentence for the person holding the parcel.
var (
	// an-incidental-line-must-say-what-it-was-for: a charge with no reason is a debt nobody can answer for.
	errReturnChargeNoteMissing = errors.New("say what the courier's charge was for")
	// The return is the order's: only an order CLAIMED as coming back is accepted. A parcel whose order is not in
	// `return` is forced to return first (a-forced-return-follows-the-status-move).
	errReturnNotClaimed = errors.New("only an order in return can be accepted")
	// a-return-never-clones-a-product: a borrowed line comes back as the team's own MAPPED product, or not at all.
	errReturnUnmapped = errors.New("the selling team has not mapped these borrowed products for returns — " +
		"the return cannot be accepted until it does")
	// both-cs-and-the-warehouse-can-return-an-order: customer service CLAIMS a return; only the people holding the goods
	// can say they are here.
	errReturnAcceptedBySeller = errors.New("a return is accepted by the warehouse holding the parcel — " +
		"the selling team claims it, it does not accept it")
	// The root team reads every order, but it is no building: the accept names the warehouse that holds the parcel.
	errReturnAcceptedByRoot = errors.New("scope the accept on the warehouse holding the parcel, not the root team")
	// only-the-return-warehouse-accepts-a-return: a team with no return warehouse has nobody who may accept its return.
	errReturnNoReturnWarehouse = errors.New("the selling team has no return warehouse — " +
		"nobody can accept its returns until it sets one")
	// revamp-has-no-real-orders-yet: an order placed before its take was recorded has no batches to mint the return from.
	errReturnNoTake = errors.New("this order has no stock take recorded, so its units cannot go back on a shelf — " +
		"the return cannot be accepted")
	// the-return-accept-page-is-accepted: every line is counted, once.
	errReturnCountEveryLine = errors.New("count every line of the order, once")
)

// OrderReturnAccept is the RETURN WAREHOUSE accepting a returned parcel: `return → return_completed`
// (the-accept-is-the-status-return-completed), with its stock half (docs/business/inventory/return_decision.md).
//
//   - WHO (only-the-return-warehouse-accepts-a-return): the order's selling team's configured return warehouse, read at
//     this moment. Any other warehouse is refused FailedPrecondition, the message naming where the parcel goes — it waits
//     there until it is carried. The order's selling team is refused — it claims a return. An order in another status
//     reads NotFound unless the caller may read it (orderReaders), which keeps ids unprobeable.
//   - WHOLE (a-return-is-never-partial): every line is counted once — broken, missing, and the racks of the sound units
//     (the-return-accept-page-is-accepted).
//   - STOCK FIRST (the order_return.md flow): inventory puts the parcel back on the shelf BEFORE the status moves —
//     one `return` transaction, a batch per batch the take drew (a-return-mints-one-batch-per-batch-the-order-took), the
//     broken and missing units as door rows (a-short-return-is-missing-at-the-door,
//     a-broken-returned-unit-is-thrown-away-at-the-door). A refusal there — a count holding a rack, a rack that is not
//     this warehouse's — refuses the whole accept, and the order stays `return`. Once per take: a retried accept whose
//     move failed after the stock went in is answered with that same transaction, and finishes the move.
//   - THE NOTE: broken and missing units are named, with the crew's notes, on ONE timeline note from the warehouse, for
//     customer service's claim on the platform (a-return-door-row-carries-an-optional-note).
//   - BORROWED LINES (a-returned-borrowed-unit-is-relabelled-at-the-accept): the units come back as the selling team's
//     mapped own product, and each such line answers its code to print over the lender's label. An unmapped one refuses
//     the whole accept (a-return-never-clones-a-product) — the backstop behind order create's own check.
//   - THE COURIER (a-return-may-carry-the-couriers-ask): an optional charge, with its note, rides OrderReturnAccepted;
//     liability posts it as the selling team's debt to the return warehouse.
//
// ⚠ NO CALL RUNS UNDER THE ORDER'S LOCK. The catalogue (whose product each line is, what the mapped product is called)
// and the stock half are calls to other services, made before the lock. The lines and the maps cannot change under them:
// an order's lines are frozen at placement and a map is written once (a-return-map-is-written-once). Only the status can,
// and it is re-read under the lock.
func (s *Service) OrderReturnAccept(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderReturnAcceptRequest],
) (*connect.Response[sellingv1.OrderReturnAcceptResponse], error) {
	teamID := req.Msg.GetTeamId()
	orderID := req.Msg.GetOrderId()
	// THE FREEZE POINT of the courier's charge, exact as typed (the-backend-never-rounds-money) — the event, the note
	// and the balance all read this one figure.
	charge := req.Msg.GetCourierCharge()
	chargeNote := strings.TrimSpace(req.Msg.GetCourierChargeNote())

	if charge > 0 && chargeNote == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errReturnChargeNoteMissing)
	}

	if readsEveryTeam(teamID) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errReturnAcceptedByRoot)
	}

	// THE ORDER — any order in return, or one this team may read (orderReaders): an outsider asking about an order in any
	// other status reads NotFound, as a read would. Not locked: what is read here is what never changes. The status is
	// checked now for a fast answer and again under the lock, which is the check that counts.
	var order selling_service_models.Order

	err := s.db.
		WithContext(ctx).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("id ASC")
		}).
		Where("id = @id AND (status = @return OR "+orderReaders+")",
			map[string]any{"id": orderID, "return": orderStatusReturn, "team": teamID}).
		First(&order).
		Error
	if err != nil {
		return nil, mapOrderErr(err)
	}

	// A team that is BOTH ends of the order is its own warehouse, and accepts as one.
	if order.TeamID == teamID && order.WarehouseID != teamID {
		return nil, connect.NewError(connect.CodePermissionDenied, errReturnAcceptedBySeller)
	}

	if order.Status != orderStatusReturn {
		return nil, returnNotClaimed(order.Status)
	}

	// ONLY THE RETURN WAREHOUSE (only-the-return-warehouse-accepts-a-return), read now.
	err = s.requireReturnWarehouse(ctx, order.TeamID, teamID)
	if err != nil {
		return nil, err
	}

	counted, err := countedReturnLines(order.Items, req.Msg.GetLines())
	if err != nil {
		return nil, err
	}

	relabels, unmapped, err := s.borrowedLines(ctx, teamID, &order)
	if err != nil {
		return nil, err
	}

	if len(unmapped) > 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("%w: %s", errReturnUnmapped, strings.Join(unmapped, ", ")))
	}

	// THE STOCK HALF, before the move (the order_return.md flow). An order with no take recorded is refused plainly.
	if order.TransactionID == nil || *order.TransactionID == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errReturnNoTake)
	}

	if s.stock == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("no stock service to put the return back on a shelf"))
	}

	stocked, err := s.stock.ReturnStock(ctx, stockReturnOf(teamID, &order, counted, relabels))
	if err != nil {
		// Inventory's own refusal, as it came: the count holding a rack, a rack that is not this warehouse's.
		var refusal *connect.Error
		if errors.As(err, &refusal) {
			return nil, refusal
		}

		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("the return could not be put back on the shelf — nothing was accepted: %w", err))
	}

	accepted, err := s.acceptReturn(ctx, teamID, orderID, stocked.TransactionID, doorNote(order.Items, stocked.Problems),
		charge, chargeNote)
	if err != nil {
		return nil, err
	}

	// THE ACCEPT IS COMMITTED. Announce it — after the commit and non-fatal, as OrderCancelled is: a rolled-back accept
	// that liability had already charged would be a debt for a return that never happened, and an accept refused because
	// a consumer could not be told would be the tail wagging the dog.
	s.publishReturnAccepted(ctx, accepted, charge, chargeNote)

	accepted.order.Items = order.Items
	accepted.order.ReturnWarehouseID = teamID

	// The answer names the buyer — from the order's one address row (one-address-per-order-and-per-draft).
	err = attachAddress(s.db.WithContext(ctx), &accepted.order)
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.OrderReturnAcceptResponse{
		Order:  orderToProto(&accepted.order),
		Labels: soundLabels(order.Items, counted, relabels),
	}), nil
}

// requireReturnWarehouse refuses an accept anywhere but the selling team's configured return warehouse
// (only-the-return-warehouse-accepts-a-return), naming where the parcel goes; a team with none cannot have a return
// accepted at all.
func (s *Service) requireReturnWarehouse(ctx context.Context, sellingTeamID, acceptingID uint64) error {
	returnWarehouse, err := returnWarehouseOf(s.db.WithContext(ctx), sellingTeamID)
	if err != nil {
		return dbError(err)
	}

	if returnWarehouse == 0 {
		return connect.NewError(connect.CodeFailedPrecondition, errReturnNoReturnWarehouse)
	}

	if returnWarehouse != acceptingID {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf(
			"this return goes to %s — only the selling team's return warehouse accepts it; the parcel waits here until "+
				"it is carried there", s.teamName(ctx, returnWarehouse)))
	}

	return nil
}

// returnWarehouseOf is a selling team's configured return warehouse, 0 when it has none
// (the-return-warehouse-lives-in-team-return-configurations — one row per team).
func returnWarehouseOf(db *gorm.DB, teamID uint64) (uint64, error) {
	var rows []selling_service_models.TeamReturnConfiguration

	err := db.
		Where("team_id = ?", teamID).
		Limit(1).
		Find(&rows).
		Error
	if err != nil {
		return 0, err
	}

	if len(rows) == 0 {
		return 0, nil
	}

	return rows[0].WarehouseID, nil
}

// returnAccepted is what the accept wrote: the order as it now is, and its `return_completed` timeline row.
type returnAccepted struct {
	order selling_service_models.Order
	log   selling_service_models.OrderTimelineLog
}

// acceptReturn is the write: lock the order, re-check it is still claimed, move it to `return_completed` with the
// courier's charge on the move's row and the accepting warehouse recorded on it, store the return's stock transaction
// on the order, and the broken and missing units on a note row at the same moment.
//
// ⚠ TWO PEOPLE ACCEPTING ONE PARCEL IN THE SAME SECOND — two of the crew scan the same box. Both reach the stock half,
// which stocks the parcel once and answers both with that one transaction; the second then waits on the first's row
// lock here, reads the status the first wrote and is refused; it never writes a second `return_completed` row, and
// never publishes a second charge.
func (s *Service) acceptReturn(
	ctx context.Context,
	teamID, orderID, returnTransactionID uint64,
	note string,
	charge float64,
	chargeNote string,
) (returnAccepted, error) {
	var accepted returnAccepted

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		order := &accepted.order

		// By id alone: the pre-read already decided the caller may accept it, and only the status can have moved since.
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", orderID).
			First(order).
			Error
		if loadErr != nil {
			return loadErr
		}

		if order.Status != orderStatusReturn {
			return returnNotClaimed(order.Status)
		}

		actor := eventActor(ctx)
		override := eventOverride(ctx)

		// The accept's own row — from the warehouse, with the courier's charge as its note when there is one: it is what
		// happened at the door, on the step it happened at. And WHERE: the accepting warehouse, the scope of this call
		// (the-accept-records-where-it-was-accepted) — the return warehouse, checked before.
		logs, statusErr := setOrdersStatus(
			tx,
			[]timelineMove{{order: order, from: timelineFromWarehouse, acceptingWarehouseID: teamID}},
			orderStatusReturnCompleted,
			actor,
			override,
			courierChargeText(charge, chargeNote),
		)
		if statusErr != nil {
			return statusErr
		}

		accepted.log = logs[0]

		// The return's stock transaction, beside the take's (an-order-is-one-inventory-transaction).
		storeErr := tx.
			Model(&selling_service_models.Order{}).
			Where("id = ?", order.ID).
			Update("return_transaction_id", returnTransactionID).
			Error
		if storeErr != nil {
			return storeErr
		}

		order.ReturnTransactionID = &returnTransactionID

		// THE DOOR'S NOTE — a note row (no status), so it is listed with the order's notes where customer service reads
		// them, at the same moment as the accept.
		if note == "" {
			return nil
		}

		return recordTimelineLogs(tx, []selling_service_models.OrderTimelineLog{{
			OrderID:    order.ID,
			Note:       note,
			From:       timelineFromWarehouse,
			ActorID:    actor,
			IsOverride: override,
			CreatedAt:  accepted.log.CreatedAt,
		}})
	})
	if err != nil {
		var refusal *connect.Error
		if errors.As(err, &refusal) {
			return accepted, refusal
		}

		return accepted, mapOrderErr(err)
	}

	return accepted, nil
}

// publishReturnAccepted announces the committed accept as OrderReturnAccepted. The event id is derived from the ORDER —
// an order is accepted once — and its moment is the accept's row's.
func (s *Service) publishReturnAccepted(ctx context.Context, accepted returnAccepted, charge float64, chargeNote string) {
	orderRef := strconv.FormatUint(accepted.order.ID, 10)

	// The note travels only with a charge: without one there is nothing it explains.
	if charge == 0 {
		chargeNote = ""
	}

	err := s.events(ctx, eventIdentity(ctx), &eventsv1.Event{
		EventId:     "order-return-accepted:" + orderRef,
		OccurredAt:  timestamppb.New(accepted.log.CreatedAt),
		AggregateId: "order:" + orderRef,
		Message: &eventsv1.Event_OrderReturnAccepted{
			OrderReturnAccepted: &eventsv1.OrderReturnAccepted{
				TeamId:  accepted.order.TeamID,
				OrderId: accepted.order.ID,
				// The warehouse that ACCEPTED it, as its row records — the return warehouse, whose door the courier was
				// paid at. Not the order's own warehouse: the parcel may have come back elsewhere
				// (a-return-may-land-in-another-warehouse).
				WarehouseId: accepted.log.AcceptingWarehouseID,
				// Read from the row the accept wrote, never the envelope's identity
				// (identity-is-a-record-never-a-credential).
				ActorId:           accepted.log.ActorID,
				ActorIsOverride:   accepted.log.IsOverride,
				TimelineLogId:     accepted.log.ID,
				CourierCharge:     charge,
				CourierChargeNote: chargeNote,
			},
		},
	})
	if err != nil {
		slog.ErrorContext(ctx, "return accepted but its OrderReturnAccepted event was not published — "+
			"the courier's charge is not on the selling team's balance and Return Arrived is short until it is",
			"order_id", accepted.order.ID,
			"courier_charge", charge,
			"timeline_log_id", accepted.log.ID,
			"error", err,
		)
	}
}

// countedLine is one order line as the crew counted it.
type countedLine struct {
	item       selling_service_models.OrderItem
	broken     uint32
	missing    uint32
	note       string
	placements []*sellingv1.OrderReturnPlacement
}

// sound is the line's units that go back on a shelf.
func (c countedLine) sound() uint32 {
	return c.item.Quantity - c.broken - c.missing
}

// countedReturnLines checks the crew's count against the order's lines (the-return-accept-page-is-accepted): every line
// of THIS order exactly once, broken + missing never above the line, and the sound units all on racks, each rack once.
// In line order.
func countedReturnLines(
	items []selling_service_models.OrderItem,
	lines []*sellingv1.OrderReturnAcceptLine,
) ([]countedLine, error) {
	byID := make(map[uint64]*sellingv1.OrderReturnAcceptLine, len(lines))

	for _, line := range lines {
		id := line.GetOrderItemId()

		if _, dup := byID[id]; dup {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%w — order line %d is counted twice", errReturnCountEveryLine, id))
		}

		byID[id] = line
	}

	out := make([]countedLine, 0, len(items))

	for _, item := range items {
		line, ok := byID[item.ID]
		if !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%w — %s is not counted", errReturnCountEveryLine, lineLabel(item)))
		}

		delete(byID, item.ID)

		broken, missing := line.GetBroken(), line.GetMissing()
		if uint64(broken)+uint64(missing) > uint64(item.Quantity) {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%d broken and %d missing of %s, but the order has %d", broken, missing, lineLabel(item),
					item.Quantity))
		}

		c := countedLine{
			item:       item,
			broken:     broken,
			missing:    missing,
			note:       strings.TrimSpace(line.GetNote()),
			placements: line.GetPlacements(),
		}

		// No note without something to explain (a-return-door-row-carries-an-optional-note).
		if broken == 0 && missing == 0 {
			c.note = ""
		}

		var placed uint64

		racks := map[uint64]bool{}

		for _, p := range c.placements {
			if racks[p.GetRackId()] {
				return nil, connect.NewError(connect.CodeInvalidArgument,
					fmt.Errorf("%s names rack %d twice — put each rack once", lineLabel(item), p.GetRackId()))
			}

			racks[p.GetRackId()] = true
			placed += uint64(p.GetQuantity())
		}

		if placed != uint64(c.sound()) {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%d sound units of %s, %d on racks — every sound unit goes on a rack", c.sound(),
					lineLabel(item), placed))
		}

		out = append(out, c)
	}

	for id := range byID {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("order line %d is not one of this order's lines", id))
	}

	return out, nil
}

// relabel is the own product a BORROWED line's units come back as (a-returned-borrowed-unit-is-relabelled-at-the-accept).
type relabel struct {
	productID uint64
	code      string
	name      string
}

// borrowedLines is each BORROWED line's relabel, by order line — the selling team's mapped own product — and the
// labels of the borrowed products with no map. One lookup of the maps and one catalogue call, whatever the order's
// size.
//
// A line is borrowed when its owner is KNOWN and is not the order's selling team, the rule order create applies
// (requireReturnMaps); an own line never reads the map (an-own-line-never-touches-the-map).
func (s *Service) borrowedLines(
	ctx context.Context,
	teamID uint64,
	order *selling_service_models.Order,
) (map[uint64]relabel, []string, error) {
	lineProducts := make([]uint64, 0, len(order.Items))
	seen := make(map[uint64]bool, len(order.Items))

	for _, item := range order.Items {
		if !seen[item.ProductID] {
			seen[item.ProductID] = true
			lineProducts = append(lineProducts, item.ProductID)
		}
	}

	if len(lineProducts) == 0 {
		return nil, nil, nil
	}

	// The maps are the SELLING team's — the team whose products these units come back as — not the warehouse's.
	var maps []selling_service_models.ProductReturnMap

	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND shared_product_id IN ?", order.TeamID, lineProducts).
		Find(&maps).
		Error
	if err != nil {
		return nil, nil, connect.NewError(connect.CodeInternal, err)
	}

	mapped := make(map[uint64]uint64, len(maps))
	lookup := append([]uint64{}, lineProducts...)

	for _, m := range maps {
		mapped[m.SharedProductID] = m.OwnProductID

		if !seen[m.OwnProductID] {
			seen[m.OwnProductID] = true
			lookup = append(lookup, m.OwnProductID)
		}
	}

	if s.catalog == nil {
		return nil, nil, connect.NewError(connect.CodeUnavailable, errors.New("no catalogue to read the products' owners from"))
	}

	// One call for both questions: whose is each line's product, and what is each mapped product called.
	snapshots, err := s.catalog.Snapshots(ctx, teamID, lookup)
	if err != nil {
		return nil, nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("the products' owners could not be looked up — nothing was accepted: %w", err))
	}

	var (
		relabels = map[uint64]relabel{}
		unmapped []string
		named    = map[uint64]bool{}
	)

	for _, item := range order.Items {
		owner := snapshots[item.ProductID].TeamID
		if owner == 0 || owner == order.TeamID {
			continue
		}

		own, ok := mapped[item.ProductID]
		if !ok {
			if !named[item.ProductID] {
				named[item.ProductID] = true
				unmapped = append(unmapped, productLabel(item.ProductID, snapshots[item.ProductID]))
			}

			continue
		}

		relabels[item.ID] = relabel{productID: own, code: snapshots[own].ProductCode, name: snapshots[own].Name}
	}

	return relabels, unmapped, nil
}

// stockReturnOf is the accept in the stock side's terms: per line the product the take drew, what it comes back as, the
// markup the team paid on a borrowed one, and the crew's count.
func stockReturnOf(
	warehouseID uint64,
	order *selling_service_models.Order,
	counted []countedLine,
	relabels map[uint64]relabel,
) StockReturn {
	out := StockReturn{
		ReturnWarehouseID: warehouseID,
		SellingTeamID:     order.TeamID,
		TakeTransactionID: *order.TransactionID,
		Description:       "return of order #" + strconv.FormatUint(order.ID, 10),
	}

	for _, c := range counted {
		line := StockReturnLine{
			ProductID:       c.item.ProductID,
			ReturnProductID: c.item.ProductID,
			Sound:           int64(c.sound()),
			Broken:          int64(c.broken),
			Missing:         int64(c.missing),
			Note:            c.note,
		}

		if r, borrowed := relabels[c.item.ID]; borrowed {
			line.ReturnProductID = r.productID
			line.MarkupRate = markupRateOf(c.item)
		}

		for _, p := range c.placements {
			line.Placements = append(line.Placements, StockReturnPlacement{RackID: p.GetRackId(), Quantity: int64(p.GetQuantity())})
		}

		out.Lines = append(out.Lines, line)
	}

	return out
}

// markupRateOf is what the team paid on top of a borrowed line's cost, as a fraction of it: its frozen markup_total over
// total − markup_total (inventory-computes-the-markup). 0 when the line froze no markup.
func markupRateOf(item selling_service_models.OrderItem) float64 {
	if item.Total == nil || item.MarkupTotal == nil {
		return 0
	}

	cost := *item.Total - *item.MarkupTotal
	if *item.MarkupTotal <= 0 || cost <= 0 {
		return 0
	}

	return *item.MarkupTotal / cost
}

// soundLabels is the label each BORROWED line's SOUND units are relabelled with, in line order — the units thrown away
// or missing get none.
func soundLabels(
	items []selling_service_models.OrderItem,
	counted []countedLine,
	relabels map[uint64]relabel,
) []*sellingv1.OrderReturnLabel {
	sound := make(map[uint64]uint32, len(counted))
	for _, c := range counted {
		sound[c.item.ID] = c.sound()
	}

	var labels []*sellingv1.OrderReturnLabel

	for _, item := range items {
		r, borrowed := relabels[item.ID]
		if !borrowed || sound[item.ID] == 0 {
			continue
		}

		labels = append(labels, &sellingv1.OrderReturnLabel{
			OrderItemId:         item.ID,
			BorrowedProductId:   item.ProductID,
			BorrowedProductCode: item.ProductCode,
			OwnProductId:        r.productID,
			OwnProductCode:      r.code,
			OwnProductName:      r.name,
			Quantity:            sound[item.ID],
		})
	}

	return labels
}

// returnNotClaimed is the refusal of an order that is not in `return` — already accepted, or not claimed yet.
func returnNotClaimed(status string) error {
	if status == orderStatusReturnCompleted {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("this return is already accepted"))
	}

	return connect.NewError(connect.CodeFailedPrecondition,
		fmt.Errorf("%w — this order is %s", errReturnNotClaimed, status))
}

// courierChargeText is the accept row's note: the courier's charge and what it was for, "" when there is none.
func courierChargeText(charge float64, note string) string {
	if charge <= 0 {
		return ""
	}

	return "Courier charge " + san_money.Text(charge) + ": " + note
}

// doorNote is the return's note for customer service, from the door rows the stock half wrote — each missing and each
// broken product named with how many and the crew's note, in line order: "Missing from the returned parcel: 1 × KPH-M
// Kaos Polos Hitam. Broken, thrown away: 1 × TOP-01 Topi Rajut (sobek di jahitan)". Empty when the parcel came back
// whole and sound.
func doorNote(items []selling_service_models.OrderItem, problems []ReturnedProblem) string {
	var missing, broken []string

	// Line order: an order names each product on one line (mergeOrderLines), so a product finds its line.
	for _, item := range items {
		for _, p := range problems {
			if p.ProductID != item.ProductID {
				continue
			}

			part := strconv.FormatInt(p.Count, 10) + " × " + lineLabel(item)
			if p.Note != "" {
				part += " (" + p.Note + ")"
			}

			if p.Broken {
				broken = append(broken, part)
			} else {
				missing = append(missing, part)
			}
		}
	}

	var sentences []string

	if len(missing) > 0 {
		sentences = append(sentences, "Missing from the returned parcel: "+strings.Join(missing, " · "))
	}

	if len(broken) > 0 {
		sentences = append(sentences, "Broken, thrown away: "+strings.Join(broken, " · "))
	}

	return strings.Join(sentences, ". ")
}

// lineLabel names an order line as it was frozen: its product code and name.
func lineLabel(item selling_service_models.OrderItem) string {
	return strings.TrimSpace(item.ProductCode + " " + item.Name)
}
