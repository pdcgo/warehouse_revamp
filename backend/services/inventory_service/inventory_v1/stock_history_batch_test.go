package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The receive movement carries its batch, and the Stock History batch filter narrows to it (#209) —
// a filter for a different batch returns nothing.
func TestStockHistory_CarriesAndFiltersByBatch(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	acceptOne(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 100, 4000000)

	// The batch minted for this product.
	batches, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1(), ProductId: product}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	batchID := batches.Msg.GetBatches()[0].GetId()

	history := func(batch uint64) []*inventoryv1.StockMovement {
		res, hErr := svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: warehouse, ProductId: product, BatchId: batch,
			Page: &commonv1.PageFilter{Page: 1, Limit: 50},
		}))
		if hErr != nil {
			t.Fatalf("StockHistory: %v", hErr)
		}
		return res.Msg.GetMovements()
	}

	// Filtered to this batch: the one receive movement, carrying the batch.
	mine := history(batchID)
	if len(mine) != 1 || mine[0].GetBatchId() != batchID {
		t.Fatalf("batch %d history = %d rows (batch on row 0 = %d), want 1 carrying %d",
			batchID, len(mine), firstBatch(mine), batchID)
	}
	if mine[0].GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE {
		t.Fatalf("row kind = %v, want RECEIVE", mine[0].GetKind())
	}

	// A different batch: nothing.
	if other := history(batchID + 999); len(other) != 0 {
		t.Fatalf("history for a foreign batch = %d rows, want 0", len(other))
	}
}

// The date range narrows the ledger by the movement's own timestamp (#225): a window around now keeps
// the receive movement, a future-only or past-only window drops it.
func TestStockHistory_FiltersByDateRange(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	acceptOne(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 100, 4000000)

	// Captured AFTER the receive, so the movement's created_at is at or before `now`.
	now := time.Now().Unix()

	count := func(from, to int64) int {
		res, hErr := svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: warehouse, ProductId: product,
			Page:     &commonv1.PageFilter{Page: 1, Limit: 50},
			FromUnix: from, ToUnix: to,
		}))
		if hErr != nil {
			t.Fatalf("StockHistory: %v", hErr)
		}
		return len(res.Msg.GetMovements())
	}

	if n := count(now-3600, now+3600); n != 1 {
		t.Fatalf("window around now = %d rows, want 1", n)
	}
	if n := count(now+3600, 0); n != 0 {
		t.Fatalf("future-only window = %d rows, want 0", n)
	}
	if n := count(0, now-3600); n != 0 {
		t.Fatalf("past-only window = %d rows, want 0", n)
	}
}

func firstBatch(m []*inventoryv1.StockMovement) uint64 {
	if len(m) == 0 {
		return 0
	}
	return m[0].GetBatchId()
}
