package inventory_v1

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE TRANSFER'S EVENTS. The shipping expense reaches the selling team's account the way a restock's does
// (the-shipping-expense-reaches-the-account-by-event): created, every edit that moves money, the refund on cancel. The
// courier's charge at B's door reaches balance from Warehouse Transfer Accepted
// (balance-posts-the-transfers-on-site-debt-from-the-event). Each is published AFTER its commit, never inside it, and
// a failed publish is logged with its event_id rather than failing the transfer (no-outbox-the-publish-is-trusted).
//
// Every event_id is DERIVED, never a fresh UUID, so a republish of the same fact collides in the listener's dedup.

func transferRef(t *models.WarehouseTransfer) string {
	return strconv.FormatUint(t.ID, 10)
}

func transferCreatedEvent(t *models.WarehouseTransfer) *eventsv1.Event {
	ref := transferRef(t)

	return &eventsv1.Event{
		EventId:     "warehouse-transfer-created:" + ref,
		OccurredAt:  timestamppb.New(t.CreatedAt),
		AggregateId: "warehouse-transfer:" + ref,
		Message: &eventsv1.Event_WarehouseTransferCreated{WarehouseTransferCreated: &eventsv1.WarehouseTransferCreated{
			TransferId:       t.ID,
			TeamId:           t.TeamID,
			FromWarehouseId:  t.FromWarehouseID,
			ToWarehouseId:    t.ToWarehouseID,
			FinanceAccountId: t.FinanceAccountID,
			Amount:           t.ShipmentCost,
			ActorId:          t.CreatedByUserID,
			CreatedAtUnix:    t.CreatedAt.Unix(),
		}},
	}
}

// transferUpdatedEvent carries both sides of an edit that moved money; its id is the edit's cost revision.
func transferUpdatedEvent(
	t *models.WarehouseTransfer,
	oldAccount uint64,
	oldAmount float64,
	actor uint64,
	at time.Time,
) *eventsv1.Event {
	ref := transferRef(t)

	return &eventsv1.Event{
		EventId:     "warehouse-transfer-updated:" + ref + ":" + strconv.FormatUint(t.CostRevision, 10),
		OccurredAt:  timestamppb.New(at),
		AggregateId: "warehouse-transfer:" + ref,
		Message: &eventsv1.Event_WarehouseTransferUpdated{WarehouseTransferUpdated: &eventsv1.WarehouseTransferUpdated{
			TransferId:          t.ID,
			TeamId:              t.TeamID,
			OldFinanceAccountId: oldAccount,
			NewFinanceAccountId: t.FinanceAccountID,
			OldAmount:           oldAmount,
			NewAmount:           t.ShipmentCost,
			ActorId:             actor,
			UpdatedAtUnix:       at.Unix(),
		}},
	}
}

// transferCancelledEvent returns whatever was posted for the trip — a transfer is cancelled once.
func transferCancelledEvent(t *models.WarehouseTransfer) *eventsv1.Event {
	ref := transferRef(t)

	cancelledAt := t.UpdatedAt
	if t.CancelledAt != nil {
		cancelledAt = *t.CancelledAt
	}

	return &eventsv1.Event{
		EventId:     "warehouse-transfer-cancelled:" + ref,
		OccurredAt:  timestamppb.New(cancelledAt),
		AggregateId: "warehouse-transfer:" + ref,
		Message: &eventsv1.Event_WarehouseTransferCancelled{WarehouseTransferCancelled: &eventsv1.WarehouseTransferCancelled{
			TransferId:       t.ID,
			TeamId:           t.TeamID,
			FinanceAccountId: t.FinanceAccountID,
			Amount:           t.ShipmentCost,
			ActorId:          t.CancelledByUserID,
			CancelledAtUnix:  cancelledAt.Unix(),
		}},
	}
}

// transferAcceptedEvent carries the courier's charge B paid at its door — published after every accept, 0 included.
func transferAcceptedEvent(t *models.WarehouseTransfer) *eventsv1.Event {
	ref := transferRef(t)

	acceptedAt := t.UpdatedAt
	if t.AcceptedAt != nil {
		acceptedAt = *t.AcceptedAt
	}

	return &eventsv1.Event{
		EventId:     "warehouse-transfer-accepted:" + ref,
		OccurredAt:  timestamppb.New(acceptedAt),
		AggregateId: "warehouse-transfer:" + ref,
		Message: &eventsv1.Event_WarehouseTransferAccepted{WarehouseTransferAccepted: &eventsv1.WarehouseTransferAccepted{
			TransferId:                  t.ID,
			TeamId:                      t.TeamID,
			FromWarehouseId:             t.FromWarehouseID,
			ToWarehouseId:               t.ToWarehouseID,
			WarehouseAdditionalCost:     t.WarehouseAdditionalCost,
			WarehouseAdditionalCostNote: t.WarehouseAdditionalCostNote,
			ActorId:                     t.AcceptedByUserID,
			AcceptedAtUnix:              acceptedAt.Unix(),
		}},
	}
}

// publishTransferEvent sends one of the events above after its commit. A failure is logged with the event_id and never
// fails the request that already committed.
func (s *Service) publishTransferEvent(ctx context.Context, event *eventsv1.Event) {
	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "warehouse transfer committed but its event was not published — its listener is short "+
			"this change",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}
