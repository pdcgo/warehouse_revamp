package inventory_service

import (
	"context"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// InventoryTxCancelSubscription is the push subscription that brings the order service's compensation of a failed create
// to inventory (the-compensation-event-is-inventory-tx-cancel, inventory-tx-cancel-is-an-order-event) — the take under
// the event's key released, the backup of the order's direct release.
//
// Declared beside the route that serves it (one-adopter-checklist-for-both-drivers). tools/san's `pubsub ensure`
// declares the same id, with a filter on event_type and a dead-letter — a subscription's filter is IMMUTABLE, so it has
// to be right at creation. The dead-letter matters here more than usual: a cancel that meets a stock count is NACKed on
// purpose and redelivered until the count ends (a-cancel-still-meets-the-count-first).
const InventoryTxCancelSubscription = "inventory-tx-cancel"

// InventoryOrderCancelledSubscription is the push subscription that brings a cancelled order to inventory
// (inventory-returns-stock-on-order-cancelled): the order's take released by its key, which the cancel no longer does
// inside its own flow. Filtered on event_type with a dead-letter, like every subscription; a release that meets a stock
// count is NACKed on purpose and redelivered until the count ends (a-cancel-still-meets-the-count-first).
const InventoryOrderCancelledSubscription = "inventory-order-cancelled"

// NewInventoryPushHandler is inventory_service's Pub/Sub PUSH entry point: one handler that dispatches on the event
// VARIANT — never on the subscription name, which a real push carries as a full path.
//
// Returning an error NACKs, so the broker redelivers; that is right for a stock count holding the take's rack or a
// database briefly down, and the subscription's dead-letter policy is what parks a message that never succeeds.
func NewInventoryPushHandler(inventory *inventory_v1.Service) event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_InventoryTxCancel:
			// The one release by key, team-checked — the same one OrderTransactionRelease runs (releaseByKey).
			return inventory.InventoryTxCancel(ctx, variant.InventoryTxCancel)

		case *eventsv1.Event_OrderCancelled:
			// A cancelled order's stock back, by its key — the same release (inventory-returns-stock-on-order-cancelled).
			return inventory.OrderCancelled(ctx, variant.OrderCancelled)

		default:
			// A variant this build does not handle. ACKed rather than NACKed: redelivering a message nothing here will
			// ever handle is a loop, not a retry. The subscription's event_type filter keeps them from arriving at all.
			return nil
		}
	}
}
