package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderCancel moves a PENDING order to CANCEL (terminal), scoped to the selling team, and ANNOUNCES IT — and inventory
// puts its stock back on that announcement (inventory-returns-stock-on-order-cancelled, backlog #10 slice 4). Any other
// status — an already cancelled order included — is rejected (FailedPrecondition).
//
// THREE STEPS, in this order:
//
//  1. THE COUNT FIRST (a-cancel-still-meets-the-count-first): before the status moves, inventory is asked — in
//     process, a read — whether a stock count holds a rack the order's take came from. If one does, the cancel is
//     refused as it always was, FailedPrecondition in the warehouse's own words naming the count, who started it and
//     when (a-lock-stops-sales-and-cancels-too), and the order stays pending, to be cancelled after the count.
//  2. THE STATUS, in one transaction with its timeline row.
//  3. OrderCancelled, after the commit, carrying the order's key K and its warehouse. Inventory's listener releases the
//     take by K (every-release-goes-by-the-key) — the same release, team-checked (the-cancel-event-names-the-team). A
//     cancel that slipped past step 1 (a count starting in the same instant) has that release refused by the lock
//     itself; the listener errors and the event is redelivered until the count ends.
//
// The stock goes back exactly where it came from — same shelves, same split — because inventory reverses the movements
// it recorded rather than trusting quantities from here.
//
// ⚠ The stock now comes back a moment AFTER the cancel answers, not inside it: the order screen says "cancelled" before
// the shelf count reads the units back. Whether to tell the person so is the owner's open question (#10 Q11); until it
// is answered no message changes.
func (s *Service) OrderCancel(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderCancelRequest],
) (*connect.Response[sellingv1.OrderCancelResponse], error) {
	var order selling_service_models.Order

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := loadScopedOrder(tx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), &order)
		if loadErr != nil {
			return loadErr
		}

		if order.Status == orderStatusCancel {
			return errAlreadyCancelled
		}

		// PENDING ONLY (who-may-cancel-a-pending-order). The status diagram's one cancel edge is
		// pending → cancel: a processed or picked order is first handed back to pending by the
		// warehouse, which is the moment the goods are unpacked and re-shelved (#136), so the stock this
		// returns is stock that is really on a shelf. Once the courier has it, putting the stock back
		// would book goods onto a shelf while they are on a van.
		//
		// What comes back after shipping is a RETURN: a different event with different money, and
		// calling it a cancel would hide that distinction rather than record it.
		if order.Status != orderStatusPending {
			return errOnlyPendingCancels
		}

		// THE COUNT FIRST, before anything changes (a-cancel-still-meets-the-count-first). An order with no warehouse or
		// no key never took stock, so no count can hold it back.
		lockErr := s.refuseCounted(ctx, &order)
		if lockErr != nil {
			return lockErr
		}

		// A cancel is the selling team's (who-may-cancel-a-pending-order).
		return setOrderStatus(tx, &order, orderStatusCancel, timelineFromSelling, eventActor(ctx), eventOverride(ctx), "")
	})
	if err != nil {
		// THE WAREHOUSE SAID WHY, in words the person can act on — a stock count holds a rack the take came from
		// (a-lock-stops-sales-and-cancels-too), naming the count, who started it and when. Handed on as it came, so the
		// screen shows that instead of an internal error; the order stays pending and is cancelled again after the count.
		var refused *connect.Error
		if errors.As(err, &refused) {
			return nil, refused
		}

		return nil, mapOrderErr(err)
	}

	// THE CANCEL IS COMMITTED. Announce it (#164) so revenue stops counting an order that fell through.
	//
	// After the commit and non-fatal, for exactly the reasons OrderCreate publishes that way: a
	// rolled-back cancel that revenue had already voided would be a live order with no revenue, and a
	// cancel that failed because a report could not be updated would be the tail wagging the dog.
	//
	// The row can be re-voided safely — RevenueVoid is idempotent and treats a missing row as success —
	// so a lost publish is repairable rather than permanent.
	//
	// EventId is DERIVED from the order, not a fresh UUID, so a redelivery and a replay collide.
	// OccurredAtUnix is the moment the transition was written — taken from the ORDER, which
	// setOrderStatus updated in memory as well as in the row, rather than a second time.Now() here
	// (guidelines/event-guideline.md #1, #2).
	orderRef := strconv.FormatUint(order.ID, 10)

	publishErr := s.events(ctx, eventIdentity(ctx), &eventsv1.Event{
		EventId:     "order-cancelled:" + orderRef,
		OccurredAt:  timestamppb.New(order.UpdatedAt),
		AggregateId: "order:" + orderRef,
		Message: &eventsv1.Event_OrderCancelled{
			OrderCancelled: &eventsv1.OrderCancelled{
				TeamId:  order.TeamID,
				OrderId: order.ID,
				// WHO CANCELLED IT — a different act from the placement it undoes, and often a
				// different person, so the reversal entries name this one
				// (every-entry-names-who-posted-it).
				ActorId: eventActor(ctx),
				// ...and whether the CANCEL was an override — the answer its timeline row was stamped with above, never
				// the placement's (an-override-is-stamped-in-every-service).
				ActorIsOverride: eventOverride(ctx),
				// The shop whose account settlement cancels the sale on — the order never calls
				// settlement (settlement-opens-the-sale-from-the-order-event).
				ShopId: order.ShopID,
				// THE KEY ITS TAKE WAS FILED UNDER, and where it was taken from: inventory releases the take by it
				// (inventory-returns-stock-on-order-cancelled, every-release-goes-by-the-key).
				IdempotencyKey: order.IdempotencyKey,
				WarehouseId:    order.WarehouseID,
			},
		},
	})
	if publishErr != nil {
		slog.ErrorContext(ctx, "order cancelled but its OrderCancelled event was not published — "+
			"its STOCK IS STILL TAKEN (release the key by hand: OrderTransactionRelease) and its revenue row is still "+
			"counting and must be voided by hand",
			"order_id", order.ID,
			"team_id", order.TeamID,
			"idempotency_key", order.IdempotencyKey,
			"warehouse_id", order.WarehouseID,
			"error", publishErr,
		)
	}

	// The answer names the buyer — from the order's one address row (one-address-per-order-and-per-draft).
	err = attachAddress(s.db.WithContext(ctx), &order)
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.OrderCancelResponse{Order: orderToProto(&order)}), nil
}

// refuseCounted refuses the cancel when a stock count holds a rack the order's take came from — asked of inventory in
// process, a read (a-cancel-still-meets-the-count-first): FailedPrecondition in the warehouse's own words, naming the
// count, exactly as the release itself used to refuse it (a-lock-stops-sales-and-cancels-too). nil when nothing holds it.
//
// An order with no warehouse (before #72) or no key never took stock, so nothing can hold it back. A check that could not
// be made refuses the cancel as Unavailable — try again — rather than moving a status nobody checked.
func (s *Service) refuseCounted(ctx context.Context, order *selling_service_models.Order) error {
	if order.WarehouseID == 0 || order.IdempotencyKey == "" {
		return nil
	}

	lock, err := s.stock.StockLockCheck(ctx, order.TeamID, order.WarehouseID, order.IdempotencyKey)
	if err != nil {
		return connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("could not check whether a stock count holds this order's stock — try again: %w", err))
	}

	if lock == nil {
		return nil
	}

	return connect.NewError(connect.CodeFailedPrecondition, errors.New(lock.Reason))
}
