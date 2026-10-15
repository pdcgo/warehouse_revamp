package inventory_v1

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE RESTOCK'S MONEY EVENTS, for the financial account that paid (a-created-restock-tells-the-financial-account,
// a-restock-names-its-paying-account, an-edit-sends-the-difference, an-edit-may-move-the-payment-to-another-account).
// Inventory announces; whoever posts the payment listens. Each is published AFTER its commit, never inside it, and a
// failed publish is logged with its event_id rather than failing the restock (no-outbox-the-publish-is-trusted).

// restockAmount is what the selling team's account paid for a restock: the goods plus the shipping — never the
// courier's charge, which the warehouse paid (the-couriers-charge-stays-out-of-total).
func restockAmount(rr *inventory_service_models.RestockRequest) int64 {
	amount := rr.ShippingCost
	for i := range rr.Items {
		amount += rr.Items[i].TotalPrice
	}

	return amount
}

// restockCreatedEvent announces a restock raised — the money left the paying account then.
func restockCreatedEvent(rr *inventory_service_models.RestockRequest) *eventsv1.Event {
	ref := strconv.FormatUint(rr.ID, 10)

	return &eventsv1.Event{
		// DERIVED, never a fresh UUID: a restock is created once, so a republish collides in the listener's dedup.
		EventId:     "restock-created:" + ref,
		OccurredAt:  timestamppb.New(rr.CreatedAt),
		AggregateId: "restock:" + ref,
		Message: &eventsv1.Event_RestockCreated{RestockCreated: &eventsv1.RestockCreated{
			RestockId:        rr.ID,
			TeamId:           rr.RequestingTeamID,
			WarehouseId:      rr.WarehouseID,
			FinanceAccountId: rr.FinanceAccountID,
			Amount:           restockAmount(rr),
			ActorId:          rr.CreatedByUserID,
			CreatedAtUnix:    rr.CreatedAt.Unix(),
		}},
	}
}

// restockUpdatedEvent announces an edit that moved the money: the amount changed, or the paying account did. It
// carries both sides, so the listener posts the difference, or moves the whole amount between accounts. `logID` is
// the edit's trail row — one event per edit, however many edits a restock has.
func restockUpdatedEvent(
	rr *inventory_service_models.RestockRequest,
	logID uint64,
	oldAccount uint64,
	oldAmount int64,
	actor uint64,
	at time.Time,
) *eventsv1.Event {
	ref := strconv.FormatUint(rr.ID, 10)

	return &eventsv1.Event{
		EventId:     "restock-updated:" + ref + ":" + strconv.FormatUint(logID, 10),
		OccurredAt:  timestamppb.New(at),
		AggregateId: "restock:" + ref,
		Message: &eventsv1.Event_RestockUpdated{RestockUpdated: &eventsv1.RestockUpdated{
			RestockId:           rr.ID,
			TeamId:              rr.RequestingTeamID,
			OldFinanceAccountId: oldAccount,
			NewFinanceAccountId: rr.FinanceAccountID,
			OldAmount:           oldAmount,
			NewAmount:           restockAmount(rr),
			ActorId:             actor,
			UpdatedAtUnix:       at.Unix(),
		}},
	}
}

// restockCancelledEvent announces a restock called off, and whether the money came back.
func restockCancelledEvent(rr *inventory_service_models.RestockRequest, moneyReturned bool) *eventsv1.Event {
	ref := strconv.FormatUint(rr.ID, 10)

	cancelledAt := rr.UpdatedAt
	if rr.CancelledAt != nil {
		cancelledAt = *rr.CancelledAt
	}

	return &eventsv1.Event{
		// A restock is cancelled once (a-restock-is-cancelled-only-while-ongoing).
		EventId:     "restock-cancelled:" + ref,
		OccurredAt:  timestamppb.New(cancelledAt),
		AggregateId: "restock:" + ref,
		Message: &eventsv1.Event_RestockCancelled{RestockCancelled: &eventsv1.RestockCancelled{
			RestockId:        rr.ID,
			TeamId:           rr.RequestingTeamID,
			FinanceAccountId: rr.FinanceAccountID,
			Amount:           restockAmount(rr),
			MoneyReturned:    moneyReturned,
			ActorId:          rr.CancelledByUserID,
			CancelledAtUnix:  cancelledAt.Unix(),
		}},
	}
}

// publishRestockMoney sends one of the events above after its commit. A failure is logged with the event_id — the
// account is then short this restock until a replay — and never fails the request that already committed.
func (s *Service) publishRestockMoney(ctx context.Context, event *eventsv1.Event) {
	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "restock committed but its money event was not published — the paying account is "+
			"short this change",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}
