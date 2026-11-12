package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// EVERY STOCK WRITER FOLDS ITS CHANGE ROWS (ready-stock-is-folded-in-the-stock-changes-own-step: "every stock change —
// the order take included, and restock accept, transfer send / receive / cancel, return accept, loss, adjustment, opname,
// sample, revaluation — writes its daily change row in its own transaction"). One case per writer, each through its real
// handler, each ending with the ledger-vs-report check: Σ batch_logs per key, day and type = the report's row.
//
// Restock accept, transfer send / receive / cancel and return accept are proved by their metrics' own books
// (restockBook, transferBook, returnBook end with the same check). A writer that forgot its StockTransaction would not
// get this far: every ledger write outside one is refused (inventory_ledgers.ErrNoStockReport).

func wantFolded(t *testing.T, f *opnameFixture, types ...string) {
	t.Helper()

	got := reportTypes(t, f.db)
	for _, ty := range types {
		if !got[ty] {
			t.Fatalf("no %q row in the report — have %v", ty, got)
		}
	}

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("the ledger-vs-report check compared nothing")
	}
}

func TestStockReport_EveryWriterFoldsItsChanges(t *testing.T) {
	t.Run("an order take and its release", func(t *testing.T) {
		f := opnameStocked(t)

		_, err := take(f.svc, "key-writer", line(otKaosHitam, 2))
		if err != nil {
			t.Fatalf("take: %v", err)
		}

		_, err = f.svc.OrderTransactionRelease(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
			TeamId: otMelati, IdempotencyKey: "key-writer",
		}))
		if err != nil {
			t.Fatalf("release: %v", err)
		}

		wantFolded(t, f, "restock", "order")

		// The take and its release on one day net in ONE row: -2 + 2.
		var row struct {
			N int64
			V float64
		}

		f.db.Raw(`SELECT change_count AS n, change_value AS v FROM inventory_stock_daily_changes
			WHERE change_type = 'order' AND product_id = ?`, otKaosHitam).Scan(&row)
		if row.N != 0 || row.V != 0 {
			t.Fatalf("the day's order row = %+v — want a take and its release netting to 0", row)
		}
	})

	t.Run("a Stock Adjust: lost, damaged, recount", func(t *testing.T) {
		f := opnameStocked(t)
		hitam := batchesOf(t, f, otKaosHitam)

		f.lostOne(t, hitam[0], f.rakA, 1)

		_, err := f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
			WarehouseId: otWarehouse, ProductId: otKaosHitam, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakA},
			ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, BatchId: hitam[0].ID, Quantity: 1,
			Reason: "torn",
		}))
		if err != nil {
			t.Fatalf("damaged: %v", err)
		}

		_, err = f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
			WarehouseId: otWarehouse, ProductId: otKaosPolos, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakA},
			ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_RECOUNT, OnHand: 3, Reason: "counted 3",
		}))
		if err != nil {
			t.Fatalf("recount: %v", err)
		}

		wantFolded(t, f, "lost", "broken")
	})

	t.Run("a stock count's finalize", func(t *testing.T) {
		f := opnameStocked(t)

		s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
		f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 3, 1)
		f.countRow(t, opDodi, s.GetId(), otKaosHitam, f.rakB, 5, 0)

		_, err := f.finalize(opAdmin(opBudi), s.GetId())
		if err != nil {
			t.Fatalf("finalize: %v", err)
		}

		wantFolded(t, f, "lost", "broken")
	})

	t.Run("a found claim approved", func(t *testing.T) {
		f := opnameStocked(t)

		r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 2)

		_, err := f.approve(opAdmin(opBudi), r.GetId())
		if err != nil {
			t.Fatalf("approve: %v", err)
		}

		wantFolded(t, f, "found")
	})

	t.Run("a sample", func(t *testing.T) {
		f := opnameStocked(t)

		_, err := f.svc.RackSample(ctxUser(8), connect.NewRequest(&inventoryv1.RackSampleRequest{
			TeamId: otWarehouse, RackId: f.rakA, Recipient: "Budi", Description: "a review video",
			Lines: []*inventoryv1.RackSampleLine{{ProductId: otKaosPolos, Quantity: 1}},
		}))
		if err != nil {
			t.Fatalf("sample: %v", err)
		}

		wantFolded(t, f, "sample")
	})

	t.Run("a price correction, value only", func(t *testing.T) {
		f := opnameStocked(t)
		b := batchesOf(t, f, otKaosHitam)[0]

		_, err := f.svc.BatchRevalue(ctxUser(77), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
			TeamId: otMelati, BatchId: b.ID, ExpectedPriceUnit: b.PriceUnit, NewPriceUnit: b.PriceUnit + 500, Reason: "invoice",
		}))
		if err != nil {
			t.Fatalf("revalue: %v", err)
		}

		wantFolded(t, f, "revaluation")

		var row struct {
			N int64
			V float64
		}

		f.db.Raw(`SELECT change_count AS n, change_value AS v FROM inventory_stock_daily_changes
			WHERE change_type = 'revaluation'`).Scan(&row)
		if row.N != 0 || row.V != float64(b.StockCount)*500 {
			t.Fatalf("the revaluation row = %+v — want 0 units and Rp %d (500 × the %d units left)", row, b.StockCount*500, b.StockCount)
		}
	})
}
