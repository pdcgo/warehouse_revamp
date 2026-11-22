package inventory_v1

import (
	"context"
	"log/slog"
	"strconv"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE CUSTOM SHIPMENT'S EVENTS (event.proto 409–412). A TEAM payer's courier cost reaches its account the way a
// transfer's shipping does — created, every edit that moves money, the refund on cancel
// (the-courier-is-paid-by-the-team-or-by-the-warehouse: *as a warehouse transfer's shipping*); a WAREHOUSE payer's cost
// reaches Team Balance from the handover (*as a restock's courier charge*). P1 publishes Created; CostUpdated, Cancelled
// and HandedOver are published by the acts that make them (P3), and their listeners are P4. Each is published AFTER its
// commit, never inside it, and a failed publish is logged with its event_id rather than failing the request
// (no-outbox-the-publish-is-trusted).
//
// Every event_id is DERIVED, never a fresh UUID, so a republish of the same fact collides in the listener's dedup.

func customShipmentRef(cs *models.CustomShipment) string {
	return strconv.FormatUint(cs.ID, 10)
}

// customShipmentCreatedEvent announces a parcel just created — a TEAM payer's account and cost with it (0 posts
// nothing), 0 and 0 for a WAREHOUSE payer. The actor and its override are the create's trail row's.
func customShipmentCreatedEvent(cs *models.CustomShipment, override bool) *eventsv1.Event {
	ref := customShipmentRef(cs)

	created := &eventsv1.CustomShipmentCreated{
		CustomShipmentId: cs.ID,
		TeamId:           cs.TeamID,
		WarehouseId:      cs.WarehouseID,
		Kind:             customShipmentKindToProto(cs.Kind),
		Payer:            customShipmentPayerToProto(cs.Payer),
		ActorId:          cs.CreatedByUserID,
		ActorIsOverride:  override,
		CreatedAtUnix:    cs.CreatedAt.Unix(),
	}

	if cs.Payer == models.CustomShipmentPayerTeam {
		created.FinanceAccountId = cs.FinanceAccountID
		created.Amount = cs.ShippingCost
	}

	return &eventsv1.Event{
		EventId:     "custom-shipment-created:" + ref,
		OccurredAt:  timestamppb.New(cs.CreatedAt),
		AggregateId: "custom-shipment:" + ref,
		Message:     &eventsv1.Event_CustomShipmentCreated{CustomShipmentCreated: created},
	}
}

// customShipmentCostUpdatedEvent carries both sides of a TEAM payer's *Ubah Ongkir* that moved money — the same account
// posts new − old; a different one gets the old back and pays the new. Its id is the edit's cost revision, so each edit
// is its own fact and a republish of one collides.
func customShipmentCostUpdatedEvent(
	cs *models.CustomShipment,
	oldAccount uint64,
	oldAmount float64,
	actor uint64,
	override bool,
) *eventsv1.Event {
	ref := customShipmentRef(cs)

	return &eventsv1.Event{
		EventId:     "custom-shipment-cost-updated:" + ref + ":" + strconv.FormatUint(cs.CostRevision, 10),
		OccurredAt:  timestamppb.New(cs.UpdatedAt),
		AggregateId: "custom-shipment:" + ref,
		Message: &eventsv1.Event_CustomShipmentCostUpdated{CustomShipmentCostUpdated: &eventsv1.CustomShipmentCostUpdated{
			CustomShipmentId:    cs.ID,
			TeamId:              cs.TeamID,
			OldFinanceAccountId: oldAccount,
			NewFinanceAccountId: cs.FinanceAccountID,
			OldAmount:           oldAmount,
			NewAmount:           cs.ShippingCost,
			ActorId:             actor,
			ActorIsOverride:     override,
			UpdatedAtUnix:       cs.UpdatedAt.Unix(),
		}},
	}
}

// customShipmentCancelledEvent gives a TEAM payer's posted cost back to the account that paid it; a WAREHOUSE payer had
// nothing posted, so it carries 0 and 0. A parcel is cancelled once.
func customShipmentCancelledEvent(cs *models.CustomShipment, override bool) *eventsv1.Event {
	ref := customShipmentRef(cs)

	cancelledAt := cs.UpdatedAt
	if cs.CancelledAt != nil {
		cancelledAt = *cs.CancelledAt
	}

	cancelled := &eventsv1.CustomShipmentCancelled{
		CustomShipmentId: cs.ID,
		TeamId:           cs.TeamID,
		WarehouseId:      cs.WarehouseID,
		Kind:             customShipmentKindToProto(cs.Kind),
		Payer:            customShipmentPayerToProto(cs.Payer),
		ActorId:          cs.CancelledByUserID,
		ActorIsOverride:  override,
		CancelledAtUnix:  cancelledAt.Unix(),
	}

	if cs.Payer == models.CustomShipmentPayerTeam {
		cancelled.FinanceAccountId = cs.FinanceAccountID
		cancelled.Amount = cs.ShippingCost
	}

	return &eventsv1.Event{
		EventId:     "custom-shipment-cancelled:" + ref,
		OccurredAt:  timestamppb.New(cancelledAt),
		AggregateId: "custom-shipment:" + ref,
		Message:     &eventsv1.Event_CustomShipmentCancelled{CustomShipmentCancelled: cancelled},
	}
}

// customShipmentHandedOverEvent announces the handover — for a WAREHOUSE payer with the cost it paid on the spot (0
// included: the listener posts nothing for it); a TEAM payer's carries 0. A parcel is handed over once.
func customShipmentHandedOverEvent(cs *models.CustomShipment, override bool) *eventsv1.Event {
	ref := customShipmentRef(cs)

	handedOverAt := cs.UpdatedAt
	if cs.HandedOverAt != nil {
		handedOverAt = *cs.HandedOverAt
	}

	handed := &eventsv1.CustomShipmentHandedOver{
		CustomShipmentId: cs.ID,
		TeamId:           cs.TeamID,
		WarehouseId:      cs.WarehouseID,
		Kind:             customShipmentKindToProto(cs.Kind),
		Payer:            customShipmentPayerToProto(cs.Payer),
		ActorId:          cs.HandedOverByUserID,
		ActorIsOverride:  override,
		HandedOverAtUnix: handedOverAt.Unix(),
	}

	if cs.Payer == models.CustomShipmentPayerWarehouse {
		handed.WarehouseCost = cs.ShippingCost
	}

	return &eventsv1.Event{
		EventId:     "custom-shipment-handed-over:" + ref,
		OccurredAt:  timestamppb.New(handedOverAt),
		AggregateId: "custom-shipment:" + ref,
		Message:     &eventsv1.Event_CustomShipmentHandedOver{CustomShipmentHandedOver: handed},
	}
}

// customShipmentReceivedEvent announces an INBOUND parcel counted in (backlog #101) — the courier's charge at the door as
// Terima finalised it, which Team Balance posts as the selling team's debt to the warehouse (0 posts nothing); the
// restock, its resolution and the stock-in it made. A parcel is counted in once.
func customShipmentReceivedEvent(cs *models.CustomShipment, link *models.RestockCustomShipment, override bool) *eventsv1.Event {
	ref := customShipmentRef(cs)

	receivedAt := cs.UpdatedAt
	if cs.ReceivedAt != nil {
		receivedAt = *cs.ReceivedAt
	}

	received := &eventsv1.CustomShipmentReceived{
		CustomShipmentId: cs.ID,
		TeamId:           cs.TeamID,
		WarehouseId:      cs.WarehouseID,
		RestockId:        cs.RestockID,
		ResolutionId:     link.ResolutionID,
		DoorCharge:       cs.ShippingCost,
		ActorId:          cs.ReceivedByUserID,
		ActorIsOverride:  override,
		ReceivedAtUnix:   receivedAt.Unix(),
	}

	if link.InventoryTransactionID != nil {
		received.TransactionId = *link.InventoryTransactionID
	}

	return &eventsv1.Event{
		EventId:     "custom-shipment-received:" + ref,
		OccurredAt:  timestamppb.New(receivedAt),
		AggregateId: "custom-shipment:" + ref,
		Message:     &eventsv1.Event_CustomShipmentReceived{CustomShipmentReceived: received},
	}
}

// publishCustomShipmentEvent sends one of the events above after its commit. A failure is logged with the event_id and
// never fails the request that already committed.
func (s *Service) publishCustomShipmentEvent(ctx context.Context, event *eventsv1.Event) {
	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "custom shipment committed but its event was not published — its listener is short "+
			"this change",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}
