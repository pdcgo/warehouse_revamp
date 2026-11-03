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
)

// OrderReturnAccept is the WAREHOUSE accepting a returned parcel: `return → return_completed`
// (the-accept-is-the-status-return-completed). Built before its stock half
// (the-return-accept-is-built-before-its-stock-half): it calls no inventory, so the units are not put back on a shelf.
//
//   - WHOLE (a-return-is-never-partial): every line comes back at its ordered quantity. Units missing from the parcel are
//     named on ONE timeline note from the warehouse (a-short-return-is-accepted-and-the-gap-written-off), for customer
//     service to claim from the platform; their write-off is inventory's and is not built.
//   - BORROWED LINES (a-returned-borrowed-unit-is-relabelled-at-the-accept): each answers the selling team's mapped own
//     product's code to print over the lender's label. An unmapped one refuses the whole accept
//     (a-return-never-clones-a-product) — the backstop behind order create's own check.
//   - THE COURIER (a-return-may-carry-the-couriers-ask): an optional charge, with its note, rides OrderReturnAccepted;
//     liability posts it as the selling team's debt to the warehouse.
//
// WHO: THE WAREHOUSE HOLDING THE PARCEL — the team the call is scoped to, whichever it is. The parcel comes back to the
// selling team's configured return warehouse, not always the one it shipped from (a-return-may-land-in-another-warehouse),
// and an old label can send it to a third (a-stale-return-location-is-accepted); its staff accept it, and THAT warehouse is
// recorded on the accept's row (the-accept-records-where-it-was-accepted) and is owed the courier's charge, paid at its
// door. So an order in return is acceptable by any warehouse; an order in any other status reads NotFound unless the caller
// may read it (orderReaders), which keeps ids unprobeable. The order's selling team is refused — it claims a return.
//
// ⚠ THE CATALOGUE IS READ BEFORE THE LOCK. Whose product each line is, and what the mapped product is called, is a
// call to product_service — never made while holding the order's row. The lines and the maps cannot change under it:
// an order's lines are frozen at placement and a map is written once (a-return-map-is-written-once). Only the status
// can, and it is re-read under the lock.
func (s *Service) OrderReturnAccept(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderReturnAcceptRequest],
) (*connect.Response[sellingv1.OrderReturnAcceptResponse], error) {
	teamID := req.Msg.GetTeamId()
	orderID := req.Msg.GetOrderId()
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

	missing, err := missingUnits(order.Items, req.Msg.GetMissingLines())
	if err != nil {
		return nil, err
	}

	labels, err := s.returnLabels(ctx, teamID, &order, missing)
	if err != nil {
		return nil, err
	}

	accepted, err := s.acceptReturn(ctx, teamID, orderID, missing, charge, chargeNote)
	if err != nil {
		return nil, err
	}

	// THE ACCEPT IS COMMITTED. Announce it — after the commit and non-fatal, as OrderCancelled is: a rolled-back accept
	// that liability had already charged would be a debt for a return that never happened, and an accept refused because
	// a consumer could not be told would be the tail wagging the dog.
	s.publishReturnAccepted(ctx, accepted, charge, chargeNote)

	accepted.order.Items = order.Items

	return connect.NewResponse(&sellingv1.OrderReturnAcceptResponse{
		Order:  orderToProto(&accepted.order),
		Labels: labels,
	}), nil
}

// returnAccepted is what the accept wrote: the order as it now is, and its `return_completed` timeline row.
type returnAccepted struct {
	order selling_service_models.Order
	log   selling_service_models.OrderTimelineLog
}

// acceptReturn is the write: lock the order, re-check it is still claimed, move it to `return_completed` with the
// courier's charge on the move's row and the accepting warehouse recorded on it, and the missing units on a note row at
// the same moment.
//
// ⚠ TWO PEOPLE ACCEPTING ONE PARCEL IN THE SAME SECOND — two of the crew scan the same box. The second waits on the
// first's row lock, then reads the status the first wrote and is refused; it never writes a second
// `return_completed` row, and never publishes a second charge.
func (s *Service) acceptReturn(
	ctx context.Context,
	teamID, orderID uint64,
	missing []missingLine,
	charge int64,
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
		// (the-accept-records-where-it-was-accepted) — asked of nobody.
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

		// THE SHORT PARCEL'S NOTE — a note row (no status), so it is listed with the order's notes where customer service
		// reads them, at the same moment as the accept.
		if len(missing) == 0 {
			return nil
		}

		return recordTimelineLogs(tx, []selling_service_models.OrderTimelineLog{{
			OrderID:    order.ID,
			Note:       missingText(missing),
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
func (s *Service) publishReturnAccepted(ctx context.Context, accepted returnAccepted, charge int64, chargeNote string) {
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
				// The warehouse that ACCEPTED it, as its row records — the one whose door the courier was paid at. Not the
				// order's own warehouse: the parcel may have come back elsewhere (a-return-may-land-in-another-warehouse).
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

// missingLine is one line's units missing from the parcel, with the line it names.
type missingLine struct {
	item     selling_service_models.OrderItem
	quantity uint32
}

// missingUnits checks the request's missing units against the order's lines: each names a line of THIS order, once, and
// never more units than the line has. In line order, so the note reads in the order the lines do.
func missingUnits(
	items []selling_service_models.OrderItem,
	lines []*sellingv1.OrderReturnMissingLine,
) ([]missingLine, error) {
	lineByID := make(map[uint64]bool, len(items))
	for _, item := range items {
		lineByID[item.ID] = true
	}

	asked := make(map[uint64]uint32, len(lines))

	for _, line := range lines {
		id := line.GetOrderItemId()

		if !lineByID[id] {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("order line %d is not one of this order's lines", id))
		}

		if _, dup := asked[id]; dup {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("order line %d is named missing twice — name each line once", id))
		}

		asked[id] = line.GetQuantity()
	}

	out := make([]missingLine, 0, len(asked))

	for _, item := range items {
		quantity, ok := asked[item.ID]
		if !ok {
			continue
		}

		if quantity > item.Quantity {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%d of %s are named missing, but the order has %d", quantity, lineLabel(item), item.Quantity))
		}

		out = append(out, missingLine{item: item, quantity: quantity})
	}

	return out, nil
}

// returnLabels is the label each BORROWED line's units are relabelled with (a-returned-borrowed-unit-is-relabelled-at-
// the-accept): the selling team's mapped own product. One lookup of the maps and one catalogue call, whatever the order's
// size.
//
// A line is borrowed when its owner is KNOWN and is not the order's selling team, the rule order create applies
// (requireReturnMaps); an own line never reads the map (an-own-line-never-touches-the-map). An unmapped borrowed line
// refuses the accept, every such product named at once.
func (s *Service) returnLabels(
	ctx context.Context,
	teamID uint64,
	order *selling_service_models.Order,
	missing []missingLine,
) ([]*sellingv1.OrderReturnLabel, error) {
	lineProducts := make([]uint64, 0, len(order.Items))
	seen := make(map[uint64]bool, len(order.Items))

	for _, item := range order.Items {
		if !seen[item.ProductID] {
			seen[item.ProductID] = true
			lineProducts = append(lineProducts, item.ProductID)
		}
	}

	if len(lineProducts) == 0 {
		return nil, nil
	}

	// The maps are the SELLING team's — the team whose products these units come back as — not the warehouse's.
	var maps []selling_service_models.ProductReturnMap

	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND shared_product_id IN ?", order.TeamID, lineProducts).
		Find(&maps).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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

	// One call for both questions: whose is each line's product, and what is each mapped product called.
	snapshots, err := s.catalog.Snapshots(ctx, teamID, lookup)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("the products' owners could not be looked up — nothing was accepted: %w", err))
	}

	gone := make(map[uint64]uint32, len(missing))
	for _, m := range missing {
		gone[m.item.ID] = m.quantity
	}

	var (
		labels   []*sellingv1.OrderReturnLabel
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

		inHand := item.Quantity - gone[item.ID]
		if inHand == 0 {
			continue
		}

		ownProduct := snapshots[own]

		labels = append(labels, &sellingv1.OrderReturnLabel{
			OrderItemId:         item.ID,
			BorrowedProductId:   item.ProductID,
			BorrowedProductCode: item.ProductCode,
			OwnProductId:        own,
			OwnProductCode:      ownProduct.ProductCode,
			OwnProductName:      ownProduct.Name,
			Quantity:            inHand,
		})
	}

	if len(unmapped) > 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("%w: %s", errReturnUnmapped, strings.Join(unmapped, ", ")))
	}

	return labels, nil
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
func courierChargeText(charge int64, note string) string {
	if charge <= 0 {
		return ""
	}

	return "Courier charge " + rupiahText(charge) + ": " + note
}

// missingText is the short parcel's note, each missing product named with how many: "Missing from the returned parcel:
// 1 × KPH-M Kaos Polos Hitam — M · 2 × TOP-01 Topi Rajut".
func missingText(missing []missingLine) string {
	parts := make([]string, 0, len(missing))
	for _, m := range missing {
		parts = append(parts, strconv.FormatUint(uint64(m.quantity), 10)+" × "+lineLabel(m.item))
	}

	return "Missing from the returned parcel: " + strings.Join(parts, " · ")
}

// lineLabel names an order line as it was frozen: its product code and name.
func lineLabel(item selling_service_models.OrderItem) string {
	return strings.TrimSpace(item.ProductCode + " " + item.Name)
}

// rupiahText is an amount as a person reads it: "Rp 15.000".
func rupiahText(amount int64) string {
	digits := strconv.FormatInt(amount, 10)

	var b strings.Builder

	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}

		b.WriteRune(r)
	}

	return "Rp " + b.String()
}
