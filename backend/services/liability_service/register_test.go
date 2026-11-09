package liability_service_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// THE ORDER'S FEES ARE MOUNTED (#186, the-event-carries-the-warehouse-fee): `san pubsub ensure` declares
// liability-order-placed and liability-order-cancelled, so the service must serve /event/<sub>/push for both — without
// the routes every push 404'd, dead-lettered, and no order fee ever reached Team Balance. Through the REAL mux, as the
// emulator calls it: an exact fractional fee (2,5% of Rp 12.666,99) posts exact, and the cancel reverses it to square.
func TestRegister_TheOrderEventsReachTheLedger(t *testing.T) {
	db := san_testdb.DB(t)
	mux := http.NewServeMux()
	liability_service.NewRegister(mux, liability_v1.NewService(db, nil, nil, nil), connect.WithInterceptors())()

	fee := 12_666.99 * 2.5 / 100
	order := placed(7_101, false)
	order.GetOrderPlaced().WarehouseFee = &fee
	order.GetOrderPlaced().Lines = nil

	deliver(t, mux, liability_service.OrderPlacedSubscription, order)

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_id = ?", 7_101).Order("id").Find(&legs).Error
	if err != nil {
		t.Fatalf("read legs: %v", err)
	}

	if len(legs) != 2 {
		t.Fatalf("%d legs, want the warehouse fee's two", len(legs))
	}

	for _, leg := range legs {
		if leg.TeamID == warehouse && leg.Amount != fee {
			t.Fatalf("the warehouse's leg = %v, want the exact %v", leg.Amount, fee)
		}
	}

	deliver(t, mux, liability_service.OrderCancelledSubscription, cancelled(7_101, false))

	var balance liability_service_models.LiabilityBalance

	err = db.Where("team_id = ? AND counterparty_id = ?", warehouse, sellingTeam).Take(&balance).Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	if balance.Balance != 0 || balance.OldestUnsettledAt != nil {
		t.Fatalf("after the cancel: balance %v, oldest %v — want square, the clock stopped", balance.Balance,
			balance.OldestUnsettledAt)
	}
}

// deliver POSTs one event to /event/<sub>/push the way Pub/Sub's push does, and requires a 2xx (an ACK).
func deliver(t *testing.T, mux *http.ServeMux, subscription string, event *eventsv1.Event) {
	t.Helper()

	// The envelope as the publisher writes it — the push route validates it (an aggregate id is required).
	event.AggregateId = event.GetEventId()

	data, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	body, err := json.Marshal(event_source.PushRequest{
		Subscription: "projects/p/subscriptions/" + subscription,
		Message:      event_source.PushMessage{Data: data, MessageID: subscription},
	})
	if err != nil {
		t.Fatalf("marshal push: %v", err)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/event/"+subscription+"/push", strings.NewReader(string(body))))

	if rec.Code/100 != 2 {
		t.Fatalf("push to %s = %d %q, want an ACK", subscription, rec.Code, rec.Body.String())
	}
}
