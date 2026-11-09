package inventory_service_test

import (
	"context"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_service "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A variant inventory does not handle is ACKed (nil) rather than NACKed: redelivering a message nothing here will ever
// handle is a loop, not a retry.
func TestInventoryPushHandler_AcksAnUnhandledVariant(t *testing.T) {
	handler := inventory_service.NewInventoryPushHandler(nil)

	err := handler(context.Background(), &eventsv1.Event{
		EventId: "order-placed:1",
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{OrderId: 1}},
	})
	if err != nil {
		t.Fatalf("an unhandled variant should ACK (nil), got: %v", err)
	}
}

// InventoryTxCancel reaches the listener (the-compensation-event-is-inventory-tx-cancel): a key nothing was taken under
// is claimed and the push acknowledged. The listener's own outcomes are inventory_v1's tests.
func TestInventoryPushHandler_DispatchesInventoryTxCancel(t *testing.T) {
	db := san_testdb.DB(t)
	handler := inventory_service.NewInventoryPushHandler(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil))

	err := handler(context.Background(), &eventsv1.Event{
		EventId: "inventory-tx-cancel:K-push",
		Message: &eventsv1.Event_InventoryTxCancel{InventoryTxCancel: &eventsv1.InventoryTxCancel{
			IdempotencyKey: "K-push", TeamId: 2, WarehouseId: 5,
		}},
	})
	if err != nil {
		t.Fatalf("InventoryTxCancel of an unseen key: %v", err)
	}

	var claimed int64
	db.Raw(`SELECT COUNT(*) FROM idempotency_order_check WHERE idempotency_key = 'K-push' AND transaction_id IS NULL`).Scan(&claimed)

	if claimed != 1 {
		t.Fatalf("the key is claimed %d times with no take, want 1 — the listener never ran the release", claimed)
	}
}

// OrderCancelled reaches the listener (inventory-returns-stock-on-order-cancelled): a key nothing was taken under is
// claimed and the push acknowledged; one with no key is acknowledged and claims nothing. The listener's own outcomes are
// inventory_v1's tests.
func TestInventoryPushHandler_DispatchesOrderCancelled(t *testing.T) {
	db := san_testdb.DB(t)
	handler := inventory_service.NewInventoryPushHandler(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil))

	for _, key := range []string{"K-cancel-push", ""} {
		err := handler(context.Background(), &eventsv1.Event{
			EventId: "order-cancelled:77",
			Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{
				TeamId: 2, OrderId: 77, ShopId: 1, IdempotencyKey: key, WarehouseId: 5,
			}},
		})
		if err != nil {
			t.Fatalf("OrderCancelled with key %q: %v", key, err)
		}
	}

	var claimed int64
	db.Raw(`SELECT COUNT(*) FROM idempotency_order_check WHERE idempotency_key IN ('K-cancel-push', '')`).Scan(&claimed)

	if claimed != 1 {
		t.Fatalf("%d keys claimed, want only K-cancel-push — the listener never ran, or claimed the empty key", claimed)
	}
}
