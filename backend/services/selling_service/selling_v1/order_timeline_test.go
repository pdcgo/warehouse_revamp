package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE ORDER'S HISTORY (00011) — every transition leaves a step, and the step names the person.
//
// The property under test is that the history is written by the TRANSITION rather than by the
// handlers: setOrderStatus is the one choke point all five moves pass through, so a move added
// later gets its step for free. A test per handler would pass while proving only that today's handlers
// each remembered to call it.
func timeline(
	t *testing.T,
	svc *selling_v1.Service,
	ctx context.Context,
	teamID, orderID uint64,
) []*sellingv1.OrderEvent {
	t.Helper()

	resp, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: teamID, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	return resp.Msg.GetOrder().GetEvents()
}

// A fresh order has exactly ONE step, and it is attributed. The placement event is written inside the
// order's own transaction, so "the order exists" and "its history starts" are one fact.
func TestOrderTimeline_PlacementIsTheFirstStep(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asUser(41)

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, ctx, 2, shopID)

	events := timeline(t, svc, ctx, 2, orderID)
	if len(events) != 1 {
		t.Fatalf("a new order has %d events, want exactly 1 (placed): %+v", len(events), events)
	}
	if events[0].GetKind() != sellingv1.OrderEventKind_ORDER_EVENT_KIND_PENDING {
		t.Fatalf("first event kind = %v, want PENDING", events[0].GetKind())
	}
	if events[0].GetActorUserId() != 41 {
		t.Fatalf("placed by user %d, want 41", events[0].GetActorUserId())
	}
	// The event's moment is the ORDER's moment, not a second clock read at the insert.
	if events[0].GetAtUnix() == 0 {
		t.Fatal("placed event has no timestamp")
	}
}

// The whole warehouse run, in order, each step by the person who took it. This is the sequence the
// Timeline tab renders, and the assertion is on ORDER as much as on membership — a history whose steps
// arrive shuffled is not a history.
func TestOrderTimeline_EveryTransitionLeavesAStep(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	seller := asUser(7)
	crew := asUser(9)

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, seller, 2, shopID)

	// The warehouse's three moves, and the crew makes all of them: confirm (the building accepting the
	// job), Set Picked and the handover. Each is attributed to `crew`, not `seller` — the timeline has to
	// name the person who actually did each step. Scoped to the WAREHOUSE, because the crew holds no role
	// in the team that placed the order. Then customer service sees it moving on the platform.
	moves := []struct {
		ctx  context.Context
		team uint64
		to   sellingv1.OrderStatus
	}{
		{crew, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED},
		{crew, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PICKED},
		{crew, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING},
		{seller, 2, sellingv1.OrderStatus_ORDER_STATUS_SHIPPED},
	}

	for _, m := range moves {
		res, err := svc.OrderStatusChange(m.ctx, connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
			TeamId: m.team, OrderIds: []uint64{orderID}, To: m.to,
		}))
		if err != nil {
			t.Fatalf("OrderStatusChange to %v: %v", m.to, err)
		}
		if !res.Msg.GetResults()[0].GetMoved() {
			t.Fatalf("move to %v refused: %s", m.to, res.Msg.GetResults()[0].GetRefusedReason())
		}
	}

	events := timeline(t, svc, seller, 2, orderID)

	wantKinds := []sellingv1.OrderEventKind{
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_PENDING,
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_PROCESSED,
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_PICKED,
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_SHIPPING,
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_SHIPPED,
	}

	if len(events) != len(wantKinds) {
		t.Fatalf("%d events, want %d: %+v", len(events), len(wantKinds), events)
	}

	for i, want := range wantKinds {
		if events[i].GetKind() != want {
			t.Fatalf("event %d = %v, want %v", i, events[i].GetKind(), want)
		}
	}

	// WHO did what — the point of the tab. The seller placed it and followed it on the platform; the
	// crew did the three warehouse moves. The two ends are told apart by the history rather than guessed
	// at from the status.
	wantActors := []uint64{7, 9, 9, 9, 7}

	for i, want := range wantActors {
		if events[i].GetActorUserId() != want {
			t.Fatalf("event %d (%v) by user %d, want %d",
				i, events[i].GetKind(), events[i].GetActorUserId(), want)
		}
	}

	// Non-decreasing in time — the preload orders by `at`, and a timeline that ran backwards would
	// render the steps out of sequence while every individual step looked right.
	for i := 1; i < len(events); i++ {
		if events[i].GetAtUnix() < events[i-1].GetAtUnix() {
			t.Fatalf("event %d is older than the one before it", i)
		}
	}
}

// A cancel is a step like any other. It matters because cancel is the one transition that also does
// work in another service (the stock return, #70) — the history must record it regardless.
func TestOrderTimeline_CancelIsRecorded(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asUser(13)

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, ctx, 2, shopID)

	_, err := svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("OrderCancel: %v", err)
	}

	events := timeline(t, svc, ctx, 2, orderID)
	if len(events) != 2 {
		t.Fatalf("%d events after cancel, want 2 (placed, cancelled): %+v", len(events), events)
	}
	if events[1].GetKind() != sellingv1.OrderEventKind_ORDER_EVENT_KIND_CANCEL {
		t.Fatalf("last event = %v, want CANCEL", events[1].GetKind())
	}
	if events[1].GetActorUserId() != 13 {
		t.Fatalf("cancelled by user %d, want 13", events[1].GetActorUserId())
	}
}

// An UNAUTHENTICATED caller still gets a step, with no actor on it.
//
// This is the deliberate difference from draftAuthor, which refuses such a call outright: the
// record-keeping must never be able to veto the work. 0 reads as "not recorded" and the screen shows
// the step with its date and no person — the same shape every backfilled row has.
func TestOrderTimeline_UnknownActorIsRecordedAsZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, ctx, 2, shopID)

	events := timeline(t, svc, ctx, 2, orderID)
	if len(events) != 1 {
		t.Fatalf("%d events, want 1: %+v", len(events), events)
	}
	if events[0].GetActorUserId() != 0 {
		t.Fatalf("actor = %d, want 0 (not recorded)", events[0].GetActorUserId())
	}
}
