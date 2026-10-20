package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// acceptLine accepts one line on rackID — `good` sellable units, plus `broken` in the box and `missing` short of it —
// and returns the minted batch's id.
//
// The line is ordered as all three together. The warehouse types what was IN THE BOX (good + broken) and how many of
// those are broken; the missing are worked out as count − received (a-short-unit-at-the-door-is-missing) — nobody
// types them.
func acceptLine(
	t *testing.T,
	svc *inventory_v1.Service,
	warehouse, rackID, product uint64,
	good, total, broken, missing int64,
) uint64 {
	t.Helper()
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, Receipt: "GRN-BK",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "KPH-001", Name: "Kaos", Count: good + broken + missing, Total: float64(total)},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	item := created.Msg.GetRequest().GetItems()[0]

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId:        item.GetId(),
			ReceivedCount: good + broken,
			BrokenCount:   broken,
			Placements:    []*inventoryv1.RestockPlacement{{PlacementId: rackID, Quantity: good}},
		}},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	list, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{ProductId: product}, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	if len(batchRows(list.Msg)) == 0 {
		t.Fatal("no batch minted")
	}
	return batchRows(list.Msg)[0].GetId()
}

// The damaged bucket splits into broken vs lost from the typed damage records (#227), the identity
// arrived = broken + lost + used + ready holds, and every batch reads as a restock origin (#230). The
// same split shows on the LIST projection as on the DETAIL.
func TestBatch_SplitsBrokenLost_AndOriginRestock(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	// Received 10 sellable, plus 2 broken, and 3 missing from the box (the batch's "lost") → arrived 15.
	batchID := acceptLine(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 10, 1500000, 2, 3)

	assertLifecycle := func(what string, b *inventoryv1.StockBatch) {
		if b.GetArrived() != 15 || b.GetBroken() != 2 || b.GetLost() != 3 || b.GetReady() != 10 || b.GetUsed() != 0 {
			t.Fatalf("%s lifecycle = a%d b%d l%d r%d u%d, want 15/2/3/10/0",
				what, b.GetArrived(), b.GetBroken(), b.GetLost(), b.GetReady(), b.GetUsed())
		}
		if b.GetArrived() != b.GetBroken()+b.GetLost()+b.GetUsed()+b.GetReady() {
			t.Fatalf("%s identity broken: arrived %d != broken+lost+used+ready", what, b.GetArrived())
		}
		if b.GetOrigin() != inventoryv1.BatchOrigin_BATCH_ORIGIN_RESTOCK {
			t.Fatalf("%s origin = %v, want RESTOCK", what, b.GetOrigin())
		}
	}

	detail, err := svc.BatchDetail(context.Background(), connect.NewRequest(&inventoryv1.BatchDetailRequest{TeamId: warehouse, BatchId: batchID}))
	if err != nil {
		t.Fatalf("BatchDetail: %v", err)
	}
	assertLifecycle("detail", detail.Msg.GetBatch())

	list, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{ProductId: product}, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	assertLifecycle("list", batchRows(list.Msg)[0])
}

// Placements carry the last opname per shelf (#226): the last ADJUST (a stock-take) on that rack. A
// shelf never counted reads 0.
func TestBatchPlacement_LastOpname(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	rackID := rack.Msg.GetRack().GetId()
	batchID := acceptLine(t, svc, warehouse, rackID, product, 10, 1000000, 0, 0)

	shelf := func() *inventoryv1.BatchShelf {
		res, pErr := svc.BatchPlacementList(context.Background(), connect.NewRequest(&inventoryv1.BatchPlacementListRequest{
			TeamId: warehouse, Filter: &inventoryv1.BatchPlacementListFilter{BatchId: batchID}, Page: page1(),
		}))
		if pErr != nil {
			t.Fatalf("BatchPlacementList: %v", pErr)
		}
		for _, s := range batchShelfRows(res.Msg) {
			if s.GetRackId() == rackID {
				return s
			}
		}
		t.Fatalf("rack %d not in placements", rackID)
		return nil
	}

	// Never counted yet.
	if got := shelf().GetLastOpnameUnix(); got != 0 {
		t.Fatalf("last opname before any count = %d, want 0", got)
	}

	// A stock-take on the rack that finds it exact still counts: the recount writes an `adjustment` rack row of 0.
	before := time.Now().Add(-time.Minute)

	_, err = svc.StockAdjust(ctxUser(1), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouse, ProductId: product, OnHand: 10, Reason: "recount",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
	}))
	if err != nil {
		t.Fatalf("recount: %v", err)
	}

	if got := shelf().GetLastOpnameUnix(); got < before.Unix() {
		t.Fatalf("last opname = %d, want the recount just made", got)
	}
}

// BatchDetail totals the units that came BACK into the batch (#228): an order's take released, which reverses the
// take's own batch rows (a-rollback-reverses-its-log-rows).
func TestBatchDetail_ReturnAggregate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	batchID := acceptLine(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 10, 1000000, 0, 0)

	detail := func() *inventoryv1.BatchDetailResponse {
		res, dErr := svc.BatchDetail(context.Background(), connect.NewRequest(&inventoryv1.BatchDetailRequest{TeamId: warehouse, BatchId: batchID}))
		if dErr != nil {
			t.Fatalf("BatchDetail: %v", dErr)
		}
		return res.Msg
	}

	// Nothing returned yet.
	if d := detail(); d.GetReturnedQty() != 0 || d.GetLastReturnUnix() != 0 {
		t.Fatalf("before any return: qty=%d last=%d, want 0/0", d.GetReturnedQty(), d.GetLastReturnUnix())
	}

	before := time.Now().Add(-time.Minute)

	for key, qty := range map[string]int64{"order:1": 4, "order:2": 1} {
		takeForOrder(t, svc, 2, warehouse, product, qty, key)

		_, err = svc.OrderTransactionRelease(ctxUser(1), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
			TeamId: 2, IdempotencyKey: key,
		}))
		if err != nil {
			t.Fatalf("release %s: %v", key, err)
		}
	}

	if d := detail(); d.GetReturnedQty() != 5 || d.GetLastReturnUnix() < before.Unix() {
		t.Fatalf("after two released takes: qty=%d last=%d, want 5 and the latest release", d.GetReturnedQty(), d.GetLastReturnUnix())
	}
}
