package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// The reason drives the model (#211): DAMAGED/LOST/FOUND change a specific batch on a shelf; a RECOUNT
// reconciles the shelf and FIFOs its delta onto the oldest batch. All keep shelf_batch reconciled.
func TestStockAdjust_ReasonDrivenAndBatchAware(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	rackID := rack.Msg.GetRack().GetId()
	acceptOne(t, svc, warehouse, rackID, product, 100, 4000000) // one batch of 100 on A

	list, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1(), ProductId: product}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	batchID := list.Msg.GetBatches()[0].GetId()

	shelfBatch := func() int64 {
		var sb inventory_service_models.StockShelfBatch
		if e := db.Where("batch_id = ? AND rack_id = ?", batchID, rackID).Take(&sb).Error; e != nil {
			return -1
		}
		return sb.Qty
	}

	adjust := func(reason inventoryv1.StockAdjustReason, batch uint64, qty, onHand int64) error {
		_, e := svc.StockAdjust(context.Background(), connect.NewRequest(&inventoryv1.StockAdjustRequest{
			WarehouseId: warehouse, ProductId: product,
			Place:      &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
			ReasonType: reason, BatchId: batch, Quantity: qty, OnHand: onHand,
		}))
		return e
	}

	// DAMAGED 5 of the batch → 95.
	if e := adjust(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, batchID, 5, 0); e != nil {
		t.Fatalf("damaged: %v", e)
	}
	if shelfBatch() != 95 {
		t.Fatalf("after damaged: shelf_batch = %d, want 95", shelfBatch())
	}

	// FOUND 3 → 98.
	if e := adjust(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND, batchID, 3, 0); e != nil {
		t.Fatalf("found: %v", e)
	}
	if shelfBatch() != 98 {
		t.Fatalf("after found: shelf_batch = %d, want 98", shelfBatch())
	}

	// RECOUNT the shelf to 90 → delta -8 lands FIFO on the (only) batch → 90.
	if e := adjust(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_RECOUNT, 0, 0, 90); e != nil {
		t.Fatalf("recount: %v", e)
	}
	if shelfBatch() != 90 {
		t.Fatalf("after recount: shelf_batch = %d, want 90 (FIFO onto oldest batch)", shelfBatch())
	}

	// The warehouse on-hand and the batch Ready agree.
	summary, err := svc.ProductStockSummary(ctx, connect.NewRequest(&inventoryv1.ProductStockSummaryRequest{TeamId: warehouse, ProductId: product}))
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if summary.Msg.GetReadyQty() != 90 {
		t.Fatalf("ready_qty = %d, want 90", summary.Msg.GetReadyQty())
	}

	// A batch reason with no batch is refused.
	if e := adjust(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, 0, 5, 0); connect.CodeOf(e) != connect.CodeInvalidArgument {
		t.Fatalf("no-batch lost code = %v, want InvalidArgument", connect.CodeOf(e))
	}

	// Losing more of the batch than the shelf holds is refused.
	if e := adjust(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, batchID, 999, 0); connect.CodeOf(e) != connect.CodeFailedPrecondition {
		t.Fatalf("over-damage code = %v, want FailedPrecondition", connect.CodeOf(e))
	}
}
