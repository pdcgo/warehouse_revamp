package selling_v1_test

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// recorder captures what was published, so a test can assert on the event rather than on a mock's
// call count.
type recorder struct {
	events     []*eventsv1.Event
	identities []*role_basev1.Identity
	fail       error
}

func (r *recorder) send(_ context.Context, identity *role_basev1.Identity, event *eventsv1.Event) error {
	if r.fail != nil {
		return r.fail
	}

	r.events = append(r.events, event)
	r.identities = append(r.identities, identity)

	return nil
}

// placed unwraps the envelope to the variant, so a test asserts on the fact rather than on the
// wrapper. The envelope's own fields are asserted separately, where they are the subject.
func (r *recorder) placed(t *testing.T) *eventsv1.OrderPlaced {
	t.Helper()

	if len(r.events) != 1 {
		t.Fatalf("published %d events, want exactly 1: %v", len(r.events), r.events)
	}

	got := r.events[0].GetOrderPlaced()
	if got == nil {
		t.Fatalf("published %v, want the OrderPlaced variant", r.events[0].GetMessage())
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
	topic, err := event_source.TopicName(&eventsv1.Event{
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{}},
	})
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

	cancelled := rec.events[1].GetOrderCancelled()
	if cancelled == nil {
		t.Fatalf("second event is %v, want the OrderCancelled variant", rec.events[1].GetMessage())
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
	svc := newServiceWithEvents(t, db, func(c context.Context, id *role_basev1.Identity, e *eventsv1.Event) error {
		if e.GetOrderCancelled() != nil {
			return errors.New("broker unavailable")
		}

		return rec.send(c, id, e)
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

// The san_event contract fields must actually be POPULATED at the publish site.
//
// This is a regression test with a real bug behind it: event_id and occurred_at_unix carry
// buf.validate constraints, and every sender validates before publishing — so leaving them unset does
// not fail loudly, it makes the publish return an error that both call sites deliberately only LOG.
// The order still succeeds, every other test stays green, and the event silently never goes out.
func TestOrderCreate_PublishesTheEventContractFields(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	rec.placed(t) // the variant must be the placed one

	event := rec.events[0]

	// DERIVED from the order, so a redelivery and a replay are the same logical fact and collide.
	want := "order-placed:" + strconv.FormatUint(created.Msg.GetOrder().GetId(), 10)
	if event.GetEventId() != want {
		t.Fatalf("event_id = %q, want %q — it must be derived from the order, never a fresh UUID", event.GetEventId(), want)
	}

	if event.GetOccurredAt().AsTime().Unix() <= 0 {
		t.Fatal("occurred_at must be filled — a consumer buckets by it")
	}

	if event.GetAggregateId() == "" {
		t.Fatal("aggregate_id must be filled — it is required, and it is the ordering key if one is ever turned on")
	}

	// The sender validates before publishing, so an unpopulated contract field would make the publish
	// fail rather than the assertion above. Prove the event passes the validation a real sender runs.
	err = event_source.EmptySender(context.Background(), event_source.SystemIdentity("test"), event)
	if err != nil {
		t.Fatalf("the published event must pass validation, or every real sender would drop it: %v", err)
	}
}

// The same, for the cancel path — which has its own publish site and its own way of getting the
// occurrence time (the order's updated_at, stamped by setOrderStatus).
func TestOrderCancel_PublishesTheEventContractFields(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	orderID := created.Msg.GetOrder().GetId()

	_, err = svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId:  2,
		OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if len(rec.events) != 2 {
		t.Fatalf("published %d events, want the placed and the cancelled", len(rec.events))
	}

	event := rec.events[1]

	if event.GetOrderCancelled() == nil {
		t.Fatalf("published %v, want the OrderCancelled variant", event.GetMessage())
	}

	want := "order-cancelled:" + strconv.FormatUint(orderID, 10)
	if event.GetEventId() != want {
		t.Fatalf("event_id = %q, want %q", event.GetEventId(), want)
	}

	if event.GetOccurredAt().AsTime().Unix() <= 0 {
		t.Fatal("occurred_at must be filled from the order's updated_at")
	}

	err = event_source.EmptySender(context.Background(), event_source.SystemIdentity("test"), event)
	if err != nil {
		t.Fatalf("the published event must pass validation: %v", err)
	}
}
