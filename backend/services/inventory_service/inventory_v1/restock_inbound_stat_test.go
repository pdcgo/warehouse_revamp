package inventory_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE INBOUND HEADLINE — what is still waiting at the warehouse's door (owner).
//
// Four numbers, and each one has a way of being wrong that the others do not catch:
//
//   - product_count counts DISTINCT products, so the same SKU on two deliveries is one thing to shelve.
//     Counting lines instead reports two, and the tile then always agrees with unit_count's shape and
//     never with reality.
//   - unit_count and amount are Σ over the lines of PENDING restocks only. A fulfilled delivery has
//     become stock and a cancelled one never arrives, so either leaking in makes a queue that never
//     drains.
//   - oldest_pending is the MIN created_at, which is the box that has been ignored — the fact a count
//     of "3 waiting" hides.
func TestRestockInboundStat(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const bandung, medan uint64 = 2, 3
	const jakarta, surabaya uint64 = 5, 6

	create := func(seller, warehouse uint64, items ...*inventoryv1.RestockRequestItem) *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: seller, WarehouseId: warehouse, Items: items,
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	stat := func(requester uint64) *inventoryv1.RestockInboundPreview {
		t.Helper()

		resp, err := svc.RestockInboundStat(ctx, connect.NewRequest(&inventoryv1.RestockInboundStatRequest{
			TeamId: jakarta,
			Filter: &inventoryv1.RestockInboundStatFilter{RequestingTeamId: requester},
		}))
		if err != nil {
			t.Fatalf("stat: %v", err)
		}

		return resp.Msg.GetPreview()
	}

	widget := func(qty, total int64) *inventoryv1.RestockRequestItem {
		return &inventoryv1.RestockRequestItem{
			ProductId: 100, Sku: "SKU-W", Name: "Widget", Quantity: qty, TotalPrice: total,
		}
	}
	gadget := func(qty, total int64) *inventoryv1.RestockRequestItem {
		return &inventoryv1.RestockRequestItem{
			ProductId: 200, Sku: "SKU-G", Name: "Gadget", Quantity: qty, TotalPrice: total,
		}
	}

	// AN EMPTY QUEUE IS 0 AND A NULL DATE, not an error and not year 1. MIN over no rows is NULL, so a
	// non-nullable scan target fails here and nowhere else.
	if empty := stat(0); empty.GetRestockCount() != 0 || empty.GetProductCount() != 0 ||
		empty.GetUnitCount() != 0 || empty.GetAmount() != 0 || empty.GetOldestPendingUnix() != 0 {
		t.Fatalf("empty queue = %+v, want all zero", empty)
	}

	before := time.Now().Add(-time.Minute).Unix()

	// Two deliveries from Bandung. The SAME widget is on both — one product to find a shelf for, not two.
	create(bandung, jakarta, widget(10, 100_000))
	create(bandung, jakarta, widget(5, 50_000), gadget(3, 30_000))

	// Medan's, so the lens has something to exclude.
	create(medan, jakarta, gadget(7, 70_000))

	// NOT THIS WAREHOUSE. Bandung's Surabaya-bound delivery must never reach Jakarta's headline, filter
	// or no filter — the scope is `warehouse_id = team` and the filter narrows it, never replaces it.
	create(bandung, surabaya, widget(1000, 9_000_000))

	// FULFILLED IS NOT WAITING. It has been counted and is now stock; leaving it in makes the queue
	// look like it never drains.
	accepted := create(bandung, jakarta, widget(4, 40_000))
	_, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: jakarta, RequestId: accepted.GetId(), Lines: allArrived(accepted),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	// CANCELLED NEVER ARRIVES.
	cancelled := create(bandung, jakarta, widget(9, 90_000))
	_, err = svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: bandung, RequestId: cancelled.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	after := time.Now().Add(time.Minute).Unix()

	// THE WHOLE QUEUE: widget + gadget = 2 products (the widget is on two deliveries and counts once),
	// 10 + 5 + 3 + 7 = 25 pieces, 250.000 rupiah.
	all := stat(0)
	// THREE deliveries, not five: the fulfilled and the cancelled one are no longer waiting. And not
	// four — the count is over REQUESTS, so the two-line delivery counts once. A count taken off the
	// item join would say four here and agree with nothing.
	if all.GetRestockCount() != 3 {
		t.Fatalf("restock count = %d, want 3 pending deliveries", all.GetRestockCount())
	}
	if all.GetProductCount() != 2 {
		t.Fatalf("product count = %d, want 2 — the same SKU on two deliveries is ONE product",
			all.GetProductCount())
	}
	if all.GetUnitCount() != 25 {
		t.Fatalf("unit count = %d, want 25", all.GetUnitCount())
	}
	if all.GetAmount() != 250_000 {
		t.Fatalf("amount = %d, want 250000", all.GetAmount())
	}

	// The oldest is the FIRST pending one this test wrote, so it lands inside the window rather than at
	// some absolute instant a test cannot assert.
	if oldest := all.GetOldestPendingUnix(); oldest < before || oldest > after {
		t.Fatalf("oldest pending = %d, want it inside [%d, %d]", oldest, before, after)
	}

	// THE REQUESTING-TEAM LENS narrows all four figures together — a headline that ignored the filter
	// under it would contradict the table it sits above.
	fromBandung := stat(bandung)
	if fromBandung.GetRestockCount() != 2 || fromBandung.GetProductCount() != 2 ||
		fromBandung.GetUnitCount() != 18 || fromBandung.GetAmount() != 180_000 {
		t.Fatalf("bandung lens = %+v, want 2 restocks / 2 products / 18 pieces / 180000", fromBandung)
	}

	fromMedan := stat(medan)
	if fromMedan.GetRestockCount() != 1 || fromMedan.GetProductCount() != 1 ||
		fromMedan.GetUnitCount() != 7 || fromMedan.GetAmount() != 70_000 {
		t.Fatalf("medan lens = %+v, want 1 restock / 1 product / 7 pieces / 70000", fromMedan)
	}

	// A team with nothing in this warehouse's queue reads as empty, not as everything — which is what a
	// filter dropped on a zero-check would do.
	if none := stat(99); none.GetUnitCount() != 0 || none.GetOldestPendingUnix() != 0 {
		t.Fatalf("unknown team lens = %+v, want empty", none)
	}
}

// The stat is warehouse-side, so the SELLING team's own read of the same rows must not go through
// this RPC. This is the scope, not the policy: the interceptor is not in a unit test's path, so what
// is asserted here is that `team_id` is matched against `warehouse_id` — a seller asking gets its own
// (empty) inbound queue rather than the deliveries it raised.
func TestRestockInboundStat_ScopedToTheReceivingWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const seller, warehouse uint64 = 2, 5

	_, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: seller, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU-W", Name: "Widget", Quantity: 10, TotalPrice: 100_000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	ask := func(team uint64) *inventoryv1.RestockInboundPreview {
		t.Helper()

		resp, err := svc.RestockInboundStat(ctx, connect.NewRequest(&inventoryv1.RestockInboundStatRequest{
			TeamId: team,
		}))
		if err != nil {
			t.Fatalf("stat: %v", err)
		}

		return resp.Msg.GetPreview()
	}

	if got := ask(warehouse); got.GetUnitCount() != 10 {
		t.Fatalf("warehouse sees %d pieces, want 10", got.GetUnitCount())
	}

	if got := ask(seller); got.GetUnitCount() != 0 {
		t.Fatalf("seller sees %d pieces of its OWN restock — the stat counts what ARRIVES, not what was raised",
			got.GetUnitCount())
	}
}
