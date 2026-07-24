package revenue_service_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	revenue_service "github.com/pdcgo/warehouse_revamp/backend/services/revenue_service"
	revenue_v1 "github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
)

// deliver pushes an event at the handler exactly as a subscription would: marshalled to protojson and
// wrapped in a PushRequest. It goes through DecodeEvent on the other side, so a field that does not
// survive serialisation fails here rather than in production.
func deliver(t *testing.T, h event_source.PushHandler, sub string, event *sellingv1.OrderPlacedEvent) error {
	t.Helper()

	data, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	return h(context.Background(), &event_source.PushRequest{
		Subscription: sub,
		Message:      event_source.PushMessage{MessageID: "m-1", Data: data},
	})
}

func placedEvent() *sellingv1.OrderPlacedEvent {
	return &sellingv1.OrderPlacedEvent{
		TeamId: 2, OrderId: 4242,
		Revenue: 35000, Cogs: 18000, ShippingCost: 5000, CostKnown: true,
	}
}

// #153 — the wiring that makes #75 and #78 real: an order placed becomes an expected-margin row.
func TestRevenuePush_RecordsTheOrdersExpectedMargin(t *testing.T) {
	db := san_testdb.DB(t)
	svc := revenue_v1.NewService(db)
	h := revenue_service.NewRevenuePushHandler(svc)

	err := deliver(t, h, revenue_service.OrderPlacedSubscription, placedEvent())
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}

	lst, err := svc.RevenueList(context.Background(), connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 10},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(lst.Msg.GetRevenues()) != 1 {
		t.Fatalf("recorded %d rows, want 1", len(lst.Msg.GetRevenues()))
	}

	got := lst.Msg.GetRevenues()[0]

	if got.GetOrderId() != 4242 {
		t.Fatalf("recorded order %d, want 4242", got.GetOrderId())
	}
	// 35.000 − 18.000 − 5.000, computed by revenue from what the event carried.
	if got.GetExpectedMargin() != 12000 {
		t.Fatalf("expected margin = %d, want 12000", got.GetExpectedMargin())
	}
	if !got.GetCostKnown() {
		t.Fatal("cost_known did not survive the event")
	}
}

// #153 — A REDELIVERY IS ACKED, NOT FAILED. This is the test that keeps the subscription alive.
//
// Pub/Sub delivers at least once, so re-seeing an order already recorded is NORMAL. Returning the
// AlreadyExists would NACK it, and Pub/Sub would redeliver it forever — a message that can never
// succeed, because the row it wants to write is already there. A poison loop built out of correct
// behaviour, and it would keep the subscription permanently backed up.
func TestRevenuePush_ARedeliveryIsAcked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := revenue_v1.NewService(db)
	h := revenue_service.NewRevenuePushHandler(svc)

	err := deliver(t, h, revenue_service.OrderPlacedSubscription, placedEvent())
	if err != nil {
		t.Fatalf("first delivery: %v", err)
	}

	// Counted BEFORE the duplicate is attempted, deliberately — the same constraint revenue_test.go
	// documents. san_testdb runs each test inside ONE transaction, and a unique violation ABORTS it in
	// Postgres: every later statement then fails with 25P02 regardless of what the handler did. So a
	// query after the violation would be testing the harness, not the code.
	lst, err := svc.RevenueList(context.Background(), connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 10},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(lst.Msg.GetRevenues()) != 1 {
		t.Fatalf("recorded %d rows after one delivery, want 1", len(lst.Msg.GetRevenues()))
	}

	// The SAME order again. Must ACK — nil — rather than surface the duplicate.
	//
	// That no second row appears is what the unique index on order_id guarantees, and it is asserted
	// where it can be: revenue_test.go's TestRevenueRecord_RefusesToRecordAnOrderTwice. What THIS test
	// can honestly prove is the thing that keeps the subscription alive — that the handler swallows the
	// duplicate instead of NACKing it.
	err = deliver(t, h, revenue_service.OrderPlacedSubscription, placedEvent())
	if err != nil {
		t.Fatalf("a redelivery must ACK, got %v — Pub/Sub would redeliver this forever", err)
	}
}

// #153 — an event for a subscription this service does not serve is ACKed and ignored, not applied.
//
// The dispatch is what stops a second subscription's events being fed to the wrong branch once revenue
// grows one.
func TestRevenuePush_IgnoresAnUnknownSubscription(t *testing.T) {
	db := san_testdb.DB(t)
	svc := revenue_v1.NewService(db)
	h := revenue_service.NewRevenuePushHandler(svc)

	err := deliver(t, h, "some-other-subscription", placedEvent())
	if err != nil {
		t.Fatalf("an unknown subscription must ACK, got %v", err)
	}

	lst, err := svc.RevenueList(context.Background(), connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 10},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(lst.Msg.GetRevenues()) != 0 {
		t.Fatalf("an event from another subscription was recorded anyway: %v", lst.Msg.GetRevenues())
	}
}

// #153 — an undecodable payload is NACKed, so it is not silently lost.
//
// It is the dead-letter policy on the subscription, not this handler, that eventually stops it going
// round forever — the handler cannot tell poison from a database that is briefly down, and guessing
// wrong in the ACK direction would throw the message away.
func TestRevenuePush_NacksAnUndecodablePayload(t *testing.T) {
	db := san_testdb.DB(t)
	svc := revenue_v1.NewService(db)
	h := revenue_service.NewRevenuePushHandler(svc)

	err := h(context.Background(), &event_source.PushRequest{
		Subscription: revenue_service.OrderPlacedSubscription,
		Message:      event_source.PushMessage{MessageID: "m-bad", Data: []byte("{not json")},
	})
	if err == nil {
		t.Fatal("an undecodable payload was ACKed — it would be silently discarded")
	}
}

// #164 — A CANCELLED ORDER STOPS COUNTING. This is the bug the void fixes: revenue recorded a row when
// the order was placed, the order was then cancelled, and nothing told revenue — so the report counted
// money from an order that fell through.
func TestRevenuePush_ACancelledOrderIsVoidedAndStopsCounting(t *testing.T) {
	db := san_testdb.DB(t)
	svc := revenue_v1.NewService(db)
	h := revenue_service.NewRevenuePushHandler(svc)
	ctx := context.Background()

	err := deliver(t, h, revenue_service.OrderPlacedSubscription, placedEvent())
	if err != nil {
		t.Fatalf("placed: %v", err)
	}

	list := func() *revenuev1.RevenueListResponse {
		t.Helper()

		res, lErr := svc.RevenueList(ctx, connect.NewRequest(&revenuev1.RevenueListRequest{
			TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 10},
		}))
		if lErr != nil {
			t.Fatalf("list: %v", lErr)
		}

		return res.Msg
	}

	// Before: it counts.
	if got := list().GetTotals().GetRevenue(); got != 35000 {
		t.Fatalf("before the cancel, total revenue = %d, want 35000", got)
	}

	// The cancel arrives.
	data, err := protojson.Marshal(&sellingv1.OrderCancelledEvent{TeamId: 2, OrderId: 4242})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	cancel := func() error {
		return h(ctx, &event_source.PushRequest{
			Subscription: revenue_service.OrderCancelledSubscription,
			Message:      event_source.PushMessage{MessageID: "c-1", Data: data},
		})
	}

	if err = cancel(); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	// After: it does not. Neither listed nor totalled — the row is kept, but it earned nothing.
	after := list()

	if got := after.GetTotals().GetRevenue(); got != 0 {
		t.Fatalf("after the cancel, total revenue = %d, want 0 — the report is still overstating", got)
	}
	// The row is STILL LISTED, and flagged. That is the difference between voiding and deleting: the
	// order was placed and then cancelled, and that is exactly what somebody looking at the money wants
	// to see. Hiding it here would make it as invisible as deleting it.
	if n := len(after.GetRevenues()); n != 1 {
		t.Fatalf("the voided row is no longer listed (%d rows) — voiding should keep it visible", n)
	}
	if !after.GetRevenues()[0].GetVoided() {
		t.Fatal("the listed row is not flagged as voided, so it reads as live money")
	}

	// A REDELIVERY MUST ACK. Pub/Sub delivers at least once, so re-voiding an already-voided row is
	// normal — NACKing it would loop forever on a message that can never succeed.
	if err = cancel(); err != nil {
		t.Fatalf("a redelivered cancel must ACK, got %v", err)
	}
}

// #164 — cancelling an order that has NO revenue row is success, not NotFound.
//
// An order placed before #153, or one whose publish was lost, has nothing to void. Refusing would turn
// an ordinary gap into a poison message that Pub/Sub redelivers forever.
func TestRevenuePush_CancellingAnUnrecordedOrderIsFine(t *testing.T) {
	db := san_testdb.DB(t)
	svc := revenue_v1.NewService(db)
	h := revenue_service.NewRevenuePushHandler(svc)

	data, err := protojson.Marshal(&sellingv1.OrderCancelledEvent{TeamId: 2, OrderId: 999999})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	err = h(context.Background(), &event_source.PushRequest{
		Subscription: revenue_service.OrderCancelledSubscription,
		Message:      event_source.PushMessage{MessageID: "c-none", Data: data},
	})
	if err != nil {
		t.Fatalf("cancelling an order with no revenue row = %v, want success", err)
	}
}
