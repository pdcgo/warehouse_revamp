//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A LONG, CORRECTED BATCH'S READS (Koreksi Harga's read half): BatchDetail's one pass over the batch's own rows (the
// returns, the corrections' sum and the newest one's price before) and the door's problem rows; a batch's history and
// the owner's history with the price columns. One batch of 5 000 units with 3 000 order takes and 20 corrections on its
// ledger, against the background volume. It found each history row's two by-transaction lookups (refExpr) scanning
// their tables — fixed by inventory 00041's two indexes (audits/services/inventory_service/performances/
// OwnerStockHistory.md): the owner's history 12.5 s -> 20 ms.
func TestPerf_BatchDetail_ALongCorrectedBatch(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)
	// The background's accepted restocks carry no transaction (0); a real accepted restock carries its own.
	err := quiet.Exec(`UPDATE restocks SET transaction_id = id + 10000000 WHERE note = 'perf-bg'`).Error
	if err != nil {
		t.Fatalf("restock transactions: %v", err)
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil)
	rack := newRack(t, svc, otWarehouse, "perf-shelf")
	perfStock(t, db, otWarehouse, 1, 1, 5000, []uint64{rack})

	product := perfProducts(1)[0]

	var batch models.Batch

	err = db.Where("product_id = ? AND warehouse_id = ?", product, otWarehouse).First(&batch).Error
	if err != nil {
		t.Fatalf("the batch: %v", err)
	}

	perfLongBatch(t, db, batch)

	price := batch.PriceUnit

	for i := range 20 {
		to := price + float64(i+1)

		_, err = svc.BatchRevalue(ctxUser(8), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
			TeamId: otMelati, BatchId: batch.ID, ExpectedPriceUnit: price, NewPriceUnit: to, Reason: "perf",
		}))
		if err != nil {
			t.Fatalf("correction %d: %v", i, err)
		}

		price = to
	}

	for _, table := range []string{"batches", "batch_logs", "inventory_transactions", "idempotency_order_check", "restocks"} {
		err = quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	perfRun(t, db, probe, "BatchDetail", 1, func(int) error {
		_, callErr := svc.BatchDetail(ctxUser(8), connect.NewRequest(&inventoryv1.BatchDetailRequest{TeamId: otWarehouse, BatchId: batch.ID}))

		return callErr
	})

	perfRun(t, db, probe, "StockHistory (batch)", 1, func(int) error {
		_, callErr := svc.StockHistory(ctxUser(8), connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: otWarehouse,
			Filter:      &inventoryv1.StockHistoryFilter{ProductId: product, BatchId: batch.ID},
			Page:        page1(),
		}))

		return callErr
	})

	perfRun(t, db, probe, "OwnerStockHistory", 1, func(int) error {
		_, callErr := svc.OwnerStockHistory(ctxUser(8), connect.NewRequest(&inventoryv1.OwnerStockHistoryRequest{
			TeamId: otMelati,
			Filter: &inventoryv1.OwnerStockHistoryFilter{ProductId: product},
			Page:   page1(),
		}))

		return callErr
	})
}

// perfLongBatch gives a batch 3 000 one-unit order takes on its ledger, each under its own transaction, the batch's own
// figures following them — the history a long-selling batch has.
func perfLongBatch(t *testing.T, db *gorm.DB, b models.Batch) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT ?, ?, 'order', 1, 'perf-long-' || g FROM generate_series(1, 3000) g`,
		`INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, actor_id)
		 SELECT ?, ?, ?, t.id, 'order', -1, -?::double precision,
		        ? - row_number() OVER (ORDER BY t.id), (? - row_number() OVER (ORDER BY t.id)) * ?::double precision, ?, 1
		 FROM inventory_transactions t WHERE t.description LIKE 'perf-long-%'`,
		`UPDATE batches SET stock_count = stock_count - 3000, stock_valuation = (stock_count - 3000) * price_unit WHERE id = ?`,
	}

	args := [][]any{
		{b.WarehouseID, b.TeamID},
		{b.WarehouseID, b.TeamID, b.ID, b.PriceUnit, b.StockCount, b.StockCount, b.PriceUnit, b.PriceUnit},
		{b.ID},
	}

	for i, stmt := range statements {
		err := quiet.Exec(stmt, args[i]...).Error
		if err != nil {
			t.Fatalf("long batch, statement %d: %v", i, err)
		}
	}
}
