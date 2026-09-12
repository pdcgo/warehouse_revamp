package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// firstBatchID accepts one line on rackID (received sellable units, plus optional damage) and returns
// the minted batch's id. `damaged` is applied as-is so a caller can mix broken and lost.
func acceptLine(
	t *testing.T,
	svc *inventory_v1.Service,
	warehouse, rackID, product uint64,
	received, total int64,
	damaged []*inventoryv1.RestockDamagedUnits,
) uint64 {
	t.Helper()
	ctx := ctxUser(1)

	var damagedQty int64
	for _, d := range damaged {
		damagedQty += d.GetQuantity()
	}

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, ShippingCode: "jne", Receipt: "GRN-BK",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "KPH-001", Name: "Kaos", Quantity: received + damagedQty, TotalPrice: total},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	item := created.Msg.GetRequest().GetItems()[0]

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId:           item.GetId(),
			ReceivedQuantity: received,
			Placements:       []*inventoryv1.RestockPlacement{{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackID}, Quantity: received}},
			Damaged:          damaged,
		}},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
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

	// Received 10 sellable, plus 2 broken and 3 lost → arrived 15.
	batchID := acceptLine(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 10, 1500000,
		[]*inventoryv1.RestockDamagedUnits{
			{Quantity: 2, Reason: "crushed", Type: broken},
			{Quantity: 3, Reason: "missing", Type: lost},
		})

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
	batchID := acceptLine(t, svc, warehouse, rackID, product, 10, 1000000, nil)

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

	// A stock-take on the shelf — recorded as an ADJUST movement (kind 2) on this warehouse/product/rack.
	counted := time.Now().Add(-time.Hour)
	rid := rackID
	mv := inventory_service_models.StockMovement{
		WarehouseID: warehouse, ProductID: product, RackID: &rid,
		Delta: 0, Balance: 10,
		Kind:      int32(inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST),
		Reason:    "recount",
		CreatedAt: counted,
	}
	if err = db.Create(&mv).Error; err != nil {
		t.Fatalf("seed opname movement: %v", err)
	}

	if got := shelf().GetLastOpnameUnix(); got != counted.Unix() {
		t.Fatalf("last opname = %d, want %d", got, counted.Unix())
	}
}

// BatchDetail totals the batch's RETURN movements (#228). Returns are batch-less in the pick/return
// flow today (see StockReturn — they reverse batch-less picks), so this seeds batch-tagged RETURN rows
// directly to prove the aggregate; production totals will fill in once returns carry their batch (#71).
func TestBatchDetail_ReturnAggregate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	batchID := acceptLine(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 10, 1000000, nil)

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

	bid := batchID
	first := time.Now().Add(-2 * time.Hour)
	last := time.Now().Add(-time.Hour)
	for _, r := range []struct {
		delta int64
		at    time.Time
	}{{4, first}, {1, last}} {
		mv := inventory_service_models.StockMovement{
			WarehouseID: warehouse, ProductID: product, BatchID: &bid,
			Delta: r.delta, Balance: r.delta,
			Kind:      int32(inventoryv1.MovementKind_MOVEMENT_KIND_RETURN),
			Reason:    "order returned",
			CreatedAt: r.at,
		}
		if err = db.Create(&mv).Error; err != nil {
			t.Fatalf("seed return movement: %v", err)
		}
	}

	if d := detail(); d.GetReturnedQty() != 5 || d.GetLastReturnUnix() != last.Unix() {
		t.Fatalf("after returns: qty=%d last=%d, want 5/%d", d.GetReturnedQty(), d.GetLastReturnUnix(), last.Unix())
	}
}
