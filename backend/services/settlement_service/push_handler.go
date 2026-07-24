package settlement_service

import (
	"context"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// The push subscriptions that feed settlement its order fees (#186).
//
// Named here rather than in the composition root because the handler DISPATCHES on them: matching on
// a string typed in two places is how the wrong events end up in the wrong branch.
//
// They are DIFFERENT subscriptions from revenue's on the same topics, and that is the point of
// Pub/Sub's fan-out: two consumers of one event, each with its own delivery state, so settlement
// falling behind never delays a revenue row and vice versa.
const (
	OrderPlacedSubscription    = "settlement-order-placed"
	OrderCancelledSubscription = "settlement-order-cancelled"
)

// NewSettlementPushHandler charges an order's fees on placement and reverses them on cancellation
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
func NewSettlementPushHandler(svc *settlement_v1.Service) event_source.PushHandler {
	return func(ctx context.Context, msg *event_source.PushRequest) error {
		switch msg.Subscription {
		case OrderPlacedSubscription:
			event := sellingv1.OrderPlacedEvent{}

			err := event_source.DecodeEvent(msg, &event)
			if err != nil {
				return err
			}

			lines := make([]settlement_v1.OrderLine, 0, len(event.GetLines()))
			for _, line := range event.GetLines() {
				lines = append(lines, settlement_v1.OrderLine{
					OwningTeamID: line.GetOwningTeamId(),
					Quantity:     line.GetQuantity(),
					UnitCost:     line.GetUnitCost(),
				})
			}

			// Translated into the ledger's own terms rather than passed through: the domain must not
			// depend on another service's wire contract, which is the same rule `StockPicker` follows
			// in the other direction.
			return svc.ChargeOrder(ctx, settlement_v1.PlacedOrder{
				TeamID:      event.GetTeamId(),
				WarehouseID: event.GetWarehouseId(),
				OrderID:     event.GetOrderId(),
				Lines:       lines,
			})

		case OrderCancelledSubscription:
			event := sellingv1.OrderCancelledEvent{}

			err := event_source.DecodeEvent(msg, &event)
			if err != nil {
				return err
			}

			// The cancel carries only ids, and needs no more: the ledger already knows what it
			// charged, so reversing reads its own entries rather than recomputing fees from rates
			// that may have changed since.
			return svc.ReverseOrder(ctx, event.GetTeamId(), event.GetOrderId())

		default:
			// A subscription this build does not know. ACKed rather than NACKed: redelivering a
			// message nothing here will ever handle is a loop, not a retry.
			return nil
		}
	}
}
