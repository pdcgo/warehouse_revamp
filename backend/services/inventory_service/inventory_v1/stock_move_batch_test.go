package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

func atRack(id uint64) *inventoryv1.StockPlace {
	return &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: id}}
}

// A batch-aware move relocates the (shelf × batch) rows with the shelf totals, and is refused when the
// source does not hold that many OF THE BATCH (#210).
func TestStockMove_BatchAware(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rackA, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack A: %v", err)
	}
	rackB, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "B-04-2"}))
	if err != nil {
		t.Fatalf("rack B: %v", err)
	}
	rackAID := rackA.Msg.GetRack().GetId()
	rackBID := rackB.Msg.GetRack().GetId()

	acceptOne(t, svc, warehouse, rackAID, product, 100, 4000000) // batch of 100 on A

	list, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1(), ProductId: product}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	batchID := list.Msg.GetBatches()[0].GetId()

	// Move 30 of the batch A → B.
	_, err = svc.StockMove(context.Background(), connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: warehouse, ProductId: product, BatchId: batchID,
		From: atRack(rackAID), To: atRack(rackBID), Quantity: 30,
	}))
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	shelfBatch := func(rack uint64) int64 {
		var sb inventory_service_models.StockShelfBatch
		e := db.Where("batch_id = ? AND rack_id = ?", batchID, rack).Take(&sb).Error
		if e != nil {
			return -1
		}
		return sb.Qty
	}
	if shelfBatch(rackAID) != 70 || shelfBatch(rackBID) != 30 {
		t.Fatalf("shelf_batch A/B = %d/%d, want 70/30", shelfBatch(rackAID), shelfBatch(rackBID))
	}

	// The batch placements read back the same split.
	places, err := svc.BatchPlacementList(ctx, connect.NewRequest(&inventoryv1.BatchPlacementListRequest{TeamId: warehouse, BatchId: batchID, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchPlacementList: %v", err)
	}
	byRack := map[uint64]int64{}
	for _, s := range places.Msg.GetShelves() {
		byRack[s.GetRackId()] = s.GetQty()
	}
	if byRack[rackAID] != 70 || byRack[rackBID] != 30 {
		t.Fatalf("batch placements A/B = %d/%d, want 70/30", byRack[rackAID], byRack[rackBID])
	}

	// Moving more of the batch than the shelf holds is refused.
	_, err = svc.StockMove(context.Background(), connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: warehouse, ProductId: product, BatchId: batchID,
		From: atRack(rackAID), To: atRack(rackBID), Quantity: 80,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("over-move code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// A batch that is not this product/warehouse reads NotFound.
	_, err = svc.StockMove(context.Background(), connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: warehouse, ProductId: product, BatchId: batchID + 999,
		From: atRack(rackAID), To: atRack(rackBID), Quantity: 5,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("foreign-batch code = %v, want NotFound", connect.CodeOf(err))
	}
}
