package inventory_service

import (
	"context"
	"log/slog"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
)

// NewInventoryPushHandler is inventory_service's Pub/Sub PUSH entry point (#102): one handler that
// dispatches on the event VARIANT and applies the change.
//
// SKELETON — no subscription consumes events yet. Inventory reacts to order/stock events, and that
// integration (order → stock) lands with #69; there is no stock variant on the Event envelope until
// then. Until a real subscription is wired, every message is ACKed as a no-op.
//
// When a real variant is added:
//   - add a case for it on the type switch below,
//   - apply the change inside a DB transaction,
//   - and claim the envelope's event_id in that SAME transaction, so a redelivery cannot double-apply.
//     The key is event_id — DERIVED from the row that caused the fact — never the transport's message
//     id, which a publisher retry mints afresh for the same fact.
//
// The push subscription MUST have a dead-letter policy (see event_source/push.go), and a filter on
// event_type: a subscription's filter is immutable, so it has to be right when the subscription is
// created.
func NewInventoryPushHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch event.GetMessage().(type) {
		// case *eventsv1.Event_StockMoved: apply it in a transaction (#69).
		default:
			slog.InfoContext(ctx, "inventory push: no handler for this variant, acking",
				slog.String("event_id", event.GetEventId()),
			)

			return nil
		}
	}
}
