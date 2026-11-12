package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
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
	batches, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{ProductId: product}, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	batchID := batchRows(batches.Msg)[0].GetId()

	history := func(batch uint64) []*inventoryv1.StockMovement {
		res, hErr := svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: warehouse,
			Filter:      &inventoryv1.StockHistoryFilter{ProductId: product, BatchId: batch},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
		if hErr != nil {
			t.Fatalf("StockHistory: %v", hErr)
		}
		return stockHistoryRows(res.Msg)
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
			WarehouseId: warehouse,
			Filter:      &inventoryv1.StockHistoryFilter{ProductId: product, FromUnix: from, ToUnix: to},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
		if hErr != nil {
			t.Fatalf("StockHistory: %v", hErr)
		}
		return len(stockHistoryRows(res.Msg))
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

// A BATCH'S HISTORY READS A PRICE CORRECTION AS ONE (the-correct-price-prototype-is-accepted: *"Harga dikoreksi · old →
// new, the reason, who, the badge"*): its own kind, no unit moved, the price before and after, the value change, the
// reason, who and the override stamp. The kind filter finds it, ADJUST no longer does, and a rack's history never shows
// it — a correction writes no rack row.
func TestStockHistory_ABatchsHistoryReadsAPriceCorrection(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	_, err := svc.BatchRevalue(ctxAs(ovRoot, otMelati, rootOutsideRole), connect.NewRequest(revalueRequest(b.ID, 10000, 12000)))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	history := func(batch uint64, kind inventoryv1.MovementKind) []*inventoryv1.StockMovement {
		res, hErr := svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: otWarehouse,
			Filter:      &inventoryv1.StockHistoryFilter{ProductId: otKaosHitam, BatchId: batch, Kind: kind},
			Page:        page1(),
		}))
		if hErr != nil {
			t.Fatalf("StockHistory: %v", hErr)
		}

		return stockHistoryRows(res.Msg)
	}

	rows := history(b.ID, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED)
	if len(rows) != 2 {
		t.Fatalf("batch history = %d rows, want the receive and the correction", len(rows))
	}

	c := rows[0]
	if c.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION || c.GetDelta() != 0 || c.GetBalance() != 10 ||
		c.GetReason() != revalueReason || c.GetActorUserId() != ovRoot || !c.GetIsOverride() || c.GetRackId() != 0 ||
		!san_money.Equal(c.GetPriceUnitBefore(), 10000) || !san_money.Equal(c.GetPriceUnitAfter(), 12000) ||
		!san_money.Equal(c.GetValueChange(), 20000) {
		t.Fatalf("correction row = %+v, want REVALUATION 0 (10 left), 10000 → 12000, +20000, the reason, Root stamped", c)
	}

	r := rows[1]
	if r.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE || !san_money.Equal(r.GetPriceUnitBefore(), 10000) ||
		!san_money.Equal(r.GetPriceUnitAfter(), 10000) || !san_money.Equal(r.GetValueChange(), 100000) {
		t.Fatalf("receive row = %+v, want its price unchanged at 10000 and +100000", r)
	}

	if got := history(b.ID, inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION); len(got) != 1 || got[0].GetId() != c.GetId() {
		t.Fatalf("REVALUATION filter = %d rows, want the correction", len(got))
	}

	if got := history(b.ID, inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST); len(got) != 0 {
		t.Fatalf("ADJUST filter = %d rows, want none — a correction is not an adjust", len(got))
	}

	for _, m := range history(0, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED) {
		if m.GetKind() == inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION {
			t.Fatalf("the racks' history shows a correction: %+v", m)
		}
	}
}
