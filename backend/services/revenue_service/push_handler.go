package revenue_service

import (
	"context"
	"log/slog"

	"connectrpc.com/connect"

	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	revenue_v1 "github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
)

// OrderPlacedSubscription is the push subscription that feeds revenue its orders (#153).
//
// Named here rather than in the composition root because the handler DISPATCHES on it: a service that
// grows a second subscription needs to tell them apart, and matching on a string typed in two places
// is how the wrong events end up in the wrong branch.
const OrderPlacedSubscription = "revenue-order-placed"

// NewRevenuePushHandler consumes OrderPlacedEvent and writes the order's expected-margin row (#153).
//
// This is the wiring that makes #75 and #78 real: RevenueRecord existed and was tested, but nothing
// called it, so the table was empty and the report had nothing to show.
//
// ⚠ THE DUPLICATE CASE IS AN ACK, NOT A FAILURE — and it is the whole reason this handler is safe.
// Pub/Sub delivers at least once, so a redelivery of an order already recorded is NORMAL, not an
// error. Returning the AlreadyExists would NACK it, and Pub/Sub would redeliver forever: the message
// can never succeed, because the row it wants to write is already there. That is a poison-message loop
// built out of correct behaviour, and it is why RevenueRecord's unique index on order_id is load-
// bearing here rather than merely defensive.
//
// The subscription still needs a DEAD-LETTER POLICY (see event_source/push.go). This handler cannot
// tell a permanently malformed payload from a database that is briefly down, so it NACKs both — and
// without a dead-letter policy the malformed one is redelivered forever.
func NewRevenuePushHandler(svc *revenue_v1.Service) event_source.PushHandler {
	return func(ctx context.Context, msg *event_source.PushRequest) error {
		switch msg.Subscription {
		case OrderPlacedSubscription:
			event := sellingv1.OrderPlacedEvent{}

			err := event_source.DecodeEvent(msg, &event)
			if err != nil {
				// Undecodable: NACKed so it is not silently lost, and the dead-letter policy is what
				// eventually stops it going round forever.
				return err
			}

			_, err = svc.RevenueRecord(ctx, connect.NewRequest(&revenuev1.RevenueRecordRequest{
				TeamId:       event.GetTeamId(),
				OrderId:      event.GetOrderId(),
				Revenue:      event.GetRevenue(),
				Cogs:         event.GetCogs(),
				ShippingCost: event.GetShippingCost(),
				CostKnown:    event.GetCostKnown(),
			}))
			if err != nil {
				if connect.CodeOf(err) == connect.CodeAlreadyExists {
					// Already recorded. The delivery did its job the first time; ACK and move on.
					slog.InfoContext(ctx, "revenue push: order already recorded, acking redelivery",
						slog.Uint64("order_id", event.GetOrderId()),
						slog.String("message_id", msg.Message.MessageID),
					)

					return nil
				}

				return err
			}

			return nil

		default:
			slog.InfoContext(ctx, "revenue push: no handler for subscription, acking",
				slog.String("subscription", msg.Subscription),
				slog.String("message_id", msg.Message.MessageID),
			)

			return nil
		}
	}
}
