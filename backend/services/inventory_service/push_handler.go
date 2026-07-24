package inventory_service

import (
	"context"
	"log/slog"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
)

// NewInventoryPushHandler is inventory_service's Pub/Sub PUSH entry point (#102), adopted from the
// warehouse_infra inventory push skeleton: one handler that dispatches by SUBSCRIPTION name and
// applies the event.
//
// SKELETON — no subscription consumes events yet. Inventory reacts to order/stock events, and that
// integration (order → stock) lands with #69; there is no StockEvent contract in this module until
// then. Until a real subscription is wired, every message is ACKed as a no-op.
//
// When a real subscription is added:
//   - decode with event_source.DecodeEvent(msg, &someEvent),
//   - apply the change inside a DB transaction,
//   - and add an exactly-once dedup (a log keyed by msg.Message.MessageID, inserted in the SAME
//     transaction with ON CONFLICT DO NOTHING) so a redelivery cannot double-apply.
//
// The push subscription MUST have a dead-letter policy (see event_source/push.go): the handler
// returns non-2xx for a malformed/failed message and Pub/Sub redelivers it forever otherwise.
func NewInventoryPushHandler() event_source.PushHandler {
	return func(ctx context.Context, msg *event_source.PushRequest) error {
		switch msg.Subscription {
		// case "<inventory-stock-sub>": decode a stock event and apply it in a transaction (#69).
		default:
			slog.InfoContext(ctx, "inventory push: no handler for subscription, acking",
				slog.String("subscription", msg.Subscription),
				slog.String("message_id", msg.Message.MessageID),
			)

			return nil
		}
	}
}
