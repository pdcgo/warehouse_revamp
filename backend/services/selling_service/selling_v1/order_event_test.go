package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// recorder captures what was published, so a test can assert on the event rather than on a mock's
// call count.
type recorder struct {
	events []proto.Message
	fail   error
}

func (r *recorder) send(_ context.Context, event proto.Message) (string, error) {
	if r.fail != nil {
		return "", r.fail
	}

	r.events = append(r.events, event)

	return "msg-1", nil
}

func (r *recorder) placed(t *testing.T) *sellingv1.OrderPlacedEvent {
	t.Helper()

	if len(r.events) != 1 {
		t.Fatalf("published %d events, want exactly 1: %v", len(r.events), r.events)
	}

	got, ok := r.events[0].(*sellingv1.OrderPlacedEvent)
	if !ok {
		t.Fatalf("published %T, want an OrderPlacedEvent", r.events[0])
	}

	return got
}

// #153 — placing an order announces it, carrying THE FROZEN MONEY rather than just an id.
//
// The figures are what makes this event worth having: revenue records what an order was expected to
// make AT THE TIME, and an event naming only an order id would make it read the order back later and
// record whatever it said then.
func TestOrderCreate_PublishesTheFrozenMoney(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	order := created.Msg.GetOrder()
	got := rec.placed(t)

	if got.GetOrderId() != order.GetId() {
		t.Fatalf("event names order %d, want %d", got.GetOrderId(), order.GetId())
	}
	if got.GetTeamId() != 2 {
		t.Fatalf("event names team %d, want the SELLING team 2", got.GetTeamId())
	}

	// Revenue is the order's TOTAL — what the buyer paid — not its subtotal.
	if got.GetRevenue() != order.GetTotal() {
		t.Fatalf("event revenue = %d, want the order total %d", got.GetRevenue(), order.GetTotal())
	}
	if got.GetCogs() != order.GetCogs() {
		t.Fatalf("event cogs = %d, want the order's frozen %d", got.GetCogs(), order.GetCogs())
	}
	if got.GetShippingCost() != order.GetShippingCost() {
		t.Fatalf("event shipping = %d, want %d", got.GetShippingCost(), order.GetShippingCost())
	}
}

// #153/#74 — the fakePicker reports NO cost for the ordered product, so cost_known must be false.
//
// This is the field a report leans on. 0 cogs is ambiguous once written down — "free" and "never
// recorded" look identical — so if the publisher guessed it from the number rather than from whether
// the cost was actually found, every uncosted order would read as pure profit and nothing would say so.
func TestOrderCreate_MarksAnUnknownCostInTheEvent(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got := rec.placed(t)

	if got.GetCostKnown() {
		t.Fatal("cost_known is true, but the picker reported no cost for the product — " +
			"this order's margin would read as pure profit with nothing flagging it")
	}
	if got.GetCogs() != 0 {
		t.Fatalf("cogs = %d, want 0 for an uncosted order", got.GetCogs())
	}
}

// #153 — A PUBLISH FAILURE MUST NOT FAIL THE ORDER.
//
// Revenue is downstream. A shop has to keep selling while the revenue service or the broker is down,
// and an order that was rejected because a report could not be written would be the tail wagging the
// dog. The order is committed by then in any case — failing the RPC afterwards would tell the caller
// something untrue about what happened.
func TestOrderCreate_SurvivesAPublishFailure(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{fail: errors.New("broker unavailable")}
	svc := newServiceWithEvents(t, db, rec.send)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(ctx, connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("a broker outage must not fail the order: %v", err)
	}

	// And the order really is there — not merely reported.
	got, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("the order was reported created but cannot be read back: %v", err)
	}
	if got.Msg.GetOrder().GetId() != created.Msg.GetOrder().GetId() {
		t.Fatal("read back a different order")
	}
}

// #153 — the event declares its own topic, so a publisher never names one.
func TestOrderPlacedEvent_DeclaresItsTopic(t *testing.T) {
	topic, err := event_source.TopicName(&sellingv1.OrderPlacedEvent{})
	if err != nil {
		t.Fatalf("TopicName: %v — the generated option package may not be linked in", err)
	}

	if topic != "order-placed" {
		t.Fatalf("topic = %q, want %q", topic, "order-placed")
	}
}

// #164 — cancelling an order ANNOUNCES it, so revenue can stop counting a sale that fell through.
func TestOrderCancel_PublishesTheCancellation(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(ctx, connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()

	_, err = svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	// Two events now: the placement, then the cancellation.
	if len(rec.events) != 2 {
		t.Fatalf("published %d events, want 2 (placed, then cancelled): %v", len(rec.events), rec.events)
	}

	cancelled, ok := rec.events[1].(*sellingv1.OrderCancelledEvent)
	if !ok {
		t.Fatalf("second event is %T, want an OrderCancelledEvent", rec.events[1])
	}

	if cancelled.GetOrderId() != id || cancelled.GetTeamId() != 2 {
		t.Fatalf("cancelled event = order %d team %d, want order %d team 2",
			cancelled.GetOrderId(), cancelled.GetTeamId(), id)
	}
}

// #164 — a publish failure must not fail the CANCEL either.
//
// The same reasoning as the placement (#153): the cancel is committed by then, and refusing it
// afterwards would tell the caller something untrue about what happened. The row can be re-voided
// safely, so a lost publish is repairable.
func TestOrderCancel_SurvivesAPublishFailure(t *testing.T) {
	db := san_testdb.DB(t)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	ctx := context.Background()

	// Placement must succeed, so the sender only starts failing once the order exists.
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, func(c context.Context, e proto.Message) (string, error) {
		if _, isCancel := e.(*sellingv1.OrderCancelledEvent); isCancel {
			return "", errors.New("broker unavailable")
		}

		return rec.send(c, e)
	})

	created, err := svc.OrderCreate(ctx, connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	res, err := svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("a broker outage must not fail the cancel: %v", err)
	}

	if res.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_CANCELLED {
		t.Fatalf("order status = %v, want CANCELLED", res.Msg.GetOrder().GetStatus())
	}
}
