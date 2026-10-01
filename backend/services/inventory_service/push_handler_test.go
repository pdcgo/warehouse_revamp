package inventory_service_test

import (
	"context"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventory_service "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service"
)

// The push handler is a skeleton (#102): no variant is handled yet, so it ACKs any event (returns nil)
// rather than NACKing and looping — rule 3 of the handler contract. Real processing plus the event_id
// claim arrive with the order→stock integration (#69).
func TestInventoryPushHandler_AcksAnyMessage(t *testing.T) {
	handler := inventory_service.NewInventoryPushHandler()

	err := handler(context.Background(), &eventsv1.Event{
		EventId: "order-placed:1",
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{OrderId: 1}},
	})
	if err != nil {
		t.Fatalf("skeleton push handler should ACK (nil), got: %v", err)
	}
}
