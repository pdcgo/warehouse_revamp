package inventory_service_test

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	inventory_service "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service"
)

// The push handler is a skeleton (#102): no subscription consumes events yet, so it ACKs any message
// (returns nil) rather than NACKing and looping. Real processing + exactly-once dedup arrive with the
// order→stock integration (#69).
func TestInventoryPushHandler_AcksAnyMessage(t *testing.T) {
	handler := inventory_service.NewInventoryPushHandler()

	err := handler(context.Background(), &event_source.PushRequest{
		Subscription: "projects/dev/subscriptions/anything",
	})
	if err != nil {
		t.Fatalf("skeleton push handler should ACK (nil), got: %v", err)
	}
}
