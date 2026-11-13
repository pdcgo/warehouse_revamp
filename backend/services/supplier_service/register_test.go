package supplier_service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// PENJUALAN'S ROUTES ARE MOUNTED: `san pubsub ensure` declares supplier-order-placed and supplier-order-cancelled, so
// the service must serve /event/<sub>/push for both — a handler unit test calls the fold directly, and an unmounted
// route would pass every one while every push 404'd and dead-lettered. Through the REAL mux, as the emulator calls it.
func TestRegister_TheOrderEventsReachTheSalesFold(t *testing.T) {
	db := san_testdb.DB(t)
	mux := http.NewServeMux()
	supplier_service.NewRegister(mux, supplier_v1.NewService(db, nil, nil, takes{}, nil), connect.WithInterceptors())()

	at := time.Date(2026, 10, 7, 3, 0, 0, 0, time.UTC)

	deliver(t, mux, supplier_service.SalesPlacedSubscription, &eventsv1.Event{
		EventId: "order-placed:9101", OccurredAt: timestamppb.New(at),
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{TeamId: 12, OrderId: 9101}},
	})
	deliver(t, mux, supplier_service.SalesCancelledSubscription, &eventsv1.Event{
		EventId: "order-cancelled:9101", OccurredAt: timestamppb.New(at.Add(24 * time.Hour)),
		Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{TeamId: 12, OrderId: 9101}},
	})

	var order supplier_service_models.SupplierSaleOrder

	err := db.Where("order_id = ?", 9101).Take(&order).Error
	if err != nil {
		t.Fatalf("the order never reached the fold: %v", err)
	}

	if order.PlacedDay == nil || order.CancelledDay == nil {
		t.Fatalf("placed %v, cancelled %v — want both folded", order.PlacedDay, order.CancelledDay)
	}
}

// A CORRECTION'S ROUTE IS MOUNTED: `san pubsub ensure` declares supplier-count-corrected, so the service serves its push
// route — through the REAL mux, the correction lands on its own day beside the accept's.
func TestRegister_ACorrectionReachesTheFold(t *testing.T) {
	db := san_testdb.DB(t)
	mux := http.NewServeMux()
	supplier_service.NewRegister(mux, supplier_v1.NewService(db, nil, nil, takes{}, nil), connect.WithInterceptors())()

	at := time.Date(2026, 10, 7, 3, 0, 0, 0, time.UTC)
	line := func(accepted, missing int64) []*eventsv1.RestockAcceptedLine {
		return []*eventsv1.RestockAcceptedLine{{ProductId: 100, OrderedCount: 10, TotalPrice: 10000, AcceptedCount: accepted, MissingCount: missing}}
	}

	deliver(t, mux, supplier_service.FoldSubscription, &eventsv1.Event{
		EventId: "restock-accepted:77", OccurredAt: timestamppb.New(at),
		Message: &eventsv1.Event_RestockAccepted{RestockAccepted: &eventsv1.RestockAccepted{
			RestockId: 77, TeamId: 12, SupplierId: 31, AcceptedOn: "2026-10-07", Lines: line(10, 0),
		}},
	})
	deliver(t, mux, supplier_service.CountCorrectedSubscription, &eventsv1.Event{
		EventId: "restock-count-corrected:5001", OccurredAt: timestamppb.New(at.Add(48 * time.Hour)),
		Message: &eventsv1.Event_RestockReceivedCountCorrected{RestockReceivedCountCorrected: &eventsv1.RestockReceivedCountCorrected{
			RestockId: 77, TeamId: 12, SupplierId: 31, CorrectedOn: "2026-10-09", Lines: line(-2, 2), TransactionId: 5001,
		}},
	})

	var rows []supplier_service_models.SupplierProductDailyReport

	err := db.Where("supplier_id = ? AND product_id = ?", 31, 100).Order("day").Find(&rows).Error
	if err != nil || len(rows) != 2 || rows[0].RestockCount != 10 || rows[1].RestockCount != -2 || rows[1].ShippingLostCount != 2 {
		t.Fatalf("the figures = %+v (%v) — want 10 on the accept's day, −2 restock / +2 lost on the correction's", rows, err)
	}
}

// takes is a GoodsReader whose every take drew nothing from a supplier.
type takes struct{}

func (takes) OrderTakeSuppliers(context.Context, uint64) ([]supplier_v1.SaleTakePart, error) {
	return nil, nil
}

func (takes) SupplierIDsByFigure(context.Context, supplier_v1.GoodsFigure, int64, int64) ([]uint64, error) {
	return nil, nil
}

func (takes) StoreGoods(context.Context, uint64) (map[uint64]supplier_v1.StoreGoods, error) {
	return nil, nil
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
