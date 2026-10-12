package liability_service

import (
	"context"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The push subscriptions that feed liability its order fees (#186).
//
// Declared here, beside the handler that serves them, so the set a service consumes is readable in one
// place (one-adopter-checklist-for-both-drivers). They name the ROUTE — /event/<sub_id>/push — and
// nothing dispatches on them any more: the handler switches on the VARIANT, because a real push carries
// the full subscription path and matching short constants sent every message to the default branch.
//
// ⚠ Each must be created with a filter on event_type (the-event-oneof-is-required makes an unknown
// variant a recorded rejection, and a filter is what stops one arriving at all). A subscription's filter
// is IMMUTABLE, so it has to be right at creation.
//
// They are DIFFERENT subscriptions from revenue's on the same topics, and that is the point of
// Pub/Sub's fan-out: two consumers of one event, each with its own delivery state, so liability
// falling behind never delays a revenue row and vice versa.
const (
	OrderPlacedSubscription    = "liability-order-placed"
	OrderCancelledSubscription = "liability-order-cancelled"
)

// NewLiabilityPushHandler charges an order's fees on placement and reverses them on cancellation
// (#186).
//
// ⚠ A REDELIVERY IS NORMAL, NOT AN ERROR. Pub/Sub delivers at least once, so the same order arriving
// twice is expected — and the ledger's unique index is what makes ACKing it safe. `ChargeOrder`
// swallows `ErrAlreadyPosted` per fee, so a redelivery where one fee landed and another did not
// completes the second without refusing the first.
//
// Returning an error NACKs, which is right for a database that is briefly down and wrong for a
// permanently malformed payload — this handler cannot tell them apart, so the subscription NEEDS A
// DEAD-LETTER POLICY. And because the ledger is the SOURCE OF TRUTH, a dead-lettered message is a fee
// that is silently never charged: something must watch that queue, which is exactly what the
// reconciliation report (#187) exists to make findable.
func NewLiabilityPushHandler(svc *liability_v1.Service) event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_OrderPlaced:
			placed := variant.OrderPlaced

			lines := make([]liability_v1.OrderLine, 0, len(placed.GetLines()))
			for _, line := range placed.GetLines() {
				lines = append(lines, liability_v1.OrderLine{
					OwningTeamID: line.GetOwningTeamId(),
					Quantity:     line.GetQuantity(),
					UnitCost:     line.GetUnitCost(),
				})
			}

			// Translated into the ledger's own terms rather than passed through: the domain must not
			// depend on another service's wire contract, which is the same rule `StockPicker` follows
			// in the other direction.
			// ⚠ ActorID is the VARIANT's actor_id — who placed the order, read from the stored row —
			// never the envelope's identity, which says who caused this publish and is a record no
			// consumer may authorise from (identity-is-a-record-never-a-credential).
			return svc.ChargeOrder(ctx, liability_v1.PlacedOrder{
				TeamID:      placed.GetTeamId(),
				WarehouseID: placed.GetWarehouseId(),
				OrderID:     placed.GetOrderId(),
				Lines:       lines,
				ActorID:     placed.GetActorId(),
			})

		case *eventsv1.Event_OrderCancelled:
			cancelled := variant.OrderCancelled

			// The cancel carries only ids, and needs no more: the ledger already knows what it
			// charged, so reversing reads its own entries rather than recomputing fees from rates
			// that may have changed since.
			return svc.ReverseOrder(ctx, cancelled.GetTeamId(), cancelled.GetOrderId(), cancelled.GetActorId())

		default:
			// A variant this build does not handle. ACKed rather than NACKed: redelivering a message
			// nothing here will ever handle is a loop, not a retry (handler rule 3). An UNSET oneof
			// never reaches here — validation rejects it before dispatch.
			return nil
		}
	}
}
