package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A DAMAGED/LOST adjust writes off the frozen cost of the lost units to expense (#211, Q4); a FOUND or
// a RECOUNT posts nothing.
func TestStockAdjust_WritesOffLossValue(t *testing.T) {
	db := san_testdb.DB(t)
	expense := &recordingExpense{}
	svc := newServiceWithExpense(t, db, expense)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	rackID := rack.Msg.GetRack().GetId()
	acceptOne(t, svc, warehouse, rackID, product, 100, 4000000) // 40.000/pc, no freight

	batches, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1(), ProductId: product}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	batchID := batches.Msg.GetBatches()[0].GetId()

	adjust := func(reason inventoryv1.StockAdjustReason, qty, onHand int64) {
		t.Helper()
		_, e := svc.StockAdjust(context.Background(), connect.NewRequest(&inventoryv1.StockAdjustRequest{
			WarehouseId: warehouse, ProductId: product,
			Place:      &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
			ReasonType: reason, BatchId: batchID, Quantity: qty, OnHand: onHand,
			Reason: "shift check",
		}))
		if e != nil {
			t.Fatalf("adjust %v: %v", reason, e)
		}
	}

	// DAMAGED 5 → writes off 5 × 40.000 = 200.000 as the warehouse's expense.
	adjust(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, 5, 0)
	if len(expense.posted) != 1 {
		t.Fatalf("after damaged: %d expense posts, want 1", len(expense.posted))
	}
	if expense.posted[0].warehouseID != warehouse || expense.posted[0].amount != 200000 {
		t.Fatalf("loss = team %d amount %d, want %d/200000", expense.posted[0].warehouseID, expense.posted[0].amount, warehouse)
	}

	// FOUND writes off nothing (it is a gain), and a RECOUNT is batch-agnostic value-wise.
	adjust(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND, 2, 0)
	if _, e := svc.StockAdjust(context.Background(), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouse, ProductId: product,
		Place:      &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_RECOUNT, OnHand: 90,
	})); e != nil {
		t.Fatalf("recount: %v", e)
	}

	if len(expense.posted) != 1 {
		t.Fatalf("found/recount posted a loss: %d total, want still 1", len(expense.posted))
	}
}
