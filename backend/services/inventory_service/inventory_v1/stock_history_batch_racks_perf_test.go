//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A BATCH'S HISTORY WITH ITS RACKS (backlog #47): each batch row looks up the rack rows of its own transaction
// (batchRackJoin) — for the count and for the page. One batch of 5 000 units with 3 000 takes on its ledger: 2 000 of two
// units off two racks (each split into two rows) and 1 000 of one unit off one rack — 5 001 history rows — against the
// ledgers' background plus 250 000 more rack rows of other products, so the by-transaction index is a realistic size.
// Page 1, and page 100 (offset 4 950) — the page walks every row before it.
func TestPerf_StockHistory_ABatchsRacks(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)
	// The background's accepted restocks carry no transaction (0); a real accepted restock carries its own.
	err := quiet.Exec(`UPDATE restocks SET transaction_id = id + 10000000 WHERE note = 'perf-bg'`).Error
	if err != nil {
		t.Fatalf("restock transactions: %v", err)
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil)
	rakA := newRack(t, svc, otWarehouse, "perf-a")
	rakB := newRack(t, svc, otWarehouse, "perf-b")
	perfStock(t, db, otWarehouse, 1, 1, 5000, []uint64{rakA})

	product := perfProducts(1)[0]

	var batch models.Batch

	err = db.Where("product_id = ? AND warehouse_id = ?", product, otWarehouse).First(&batch).Error
	if err != nil {
		t.Fatalf("the batch: %v", err)
	}

	perfRackedTakes(t, db, batch, rakA, rakB)

	for _, table := range []string{"batches", "batch_logs", "product_placement_logs", "inventory_transactions", "idempotency_order_check", "restocks"} {
		err = quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	var rows int64

	err = quiet.Raw(`SELECT COUNT(*) FROM product_placement_logs`).Scan(&rows).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	t.Logf("product_placement_logs: %d rows", rows)

	for _, p := range []uint32{1, 100} {
		perfRun(t, db, probe, "StockHistory (batch, racks)", int(p), func(int) error {
			res, callErr := svc.StockHistory(ctxUser(8), connect.NewRequest(&inventoryv1.StockHistoryRequest{
				WarehouseId: otWarehouse,
				Filter:      &inventoryv1.StockHistoryFilter{ProductId: product, BatchId: batch.ID},
				Page:        &commonv1.CommonPagination{Page: p, Limit: 50},
			}))
			if callErr == nil && res.Msg.GetPageInfo().GetTotalItems() != 5001 {
				t.Fatalf("total = %d, want 5 001", res.Msg.GetPageInfo().GetTotalItems())
			}

			return callErr
		})
	}
}

// perfRackedTakes puts 3 000 order takes on the batch's ledger, each under its own transaction, with the rack rows a
// take writes: 2 000 of two units, one off each rack, then 1 000 of one unit off Rak A. Plus 250 000 rack rows of other
// products under the background's transactions.
func perfRackedTakes(t *testing.T, db *gorm.DB, b models.Batch, rakA, rakB uint64) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT ?, ?, 'order', 1, 'perf-rack-' || g FROM generate_series(1, 3000) g`,
		`INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, actor_id)
		 SELECT ?, ?, ?, t.id, 'order', -u, -u * ?::double precision,
		        ? - SUM(u) OVER (ORDER BY t.id), (? - SUM(u) OVER (ORDER BY t.id)) * ?::double precision, ?, 1
		 FROM (SELECT t.id, CASE WHEN t.id - MIN(t.id) OVER () < 2000 THEN 2 ELSE 1 END AS u
		       FROM inventory_transactions t WHERE t.description LIKE 'perf-rack-%') t`,
		`INSERT INTO product_placement_logs (warehouse_id, team_id, product_id, placement_id, transaction_id, change_type,
		                                     stock_change, stock_after, actor_id)
		 SELECT l.warehouse_id, l.team_id, ?, r.rack, l.transaction_id, 'order', -1, 0, 1
		 FROM batch_logs l
		 CROSS JOIN LATERAL (VALUES (?::bigint, 1), (?::bigint, 2)) AS r(rack, n)
		 WHERE l.batch_id = ? AND l.change_type = 'order' AND r.n <= -l.change_count
		 ORDER BY l.id, r.n`,
		`UPDATE batches SET stock_count = stock_count - 5000, stock_valuation = 0 WHERE id = ?`,
		`INSERT INTO product_placement_logs (warehouse_id, team_id, product_id, placement_id, transaction_id, change_type,
		                                     stock_change, stock_after, actor_id)
		 SELECT p.warehouse_id, 2, 100000 + p.id % 2500, p.id, t.id, 'order', -1, 0, 1
		 FROM inventory_transactions t
		 CROSS JOIN generate_series(1, 5) k
		 JOIN placements p ON p.code = 'bg-' || (1 + (t.id + k * 7) % 10000)
		 WHERE t.description = 'perf-bg'`,
	}

	args := [][]any{
		{b.WarehouseID, b.TeamID},
		{b.WarehouseID, b.TeamID, b.ID, b.PriceUnit, b.StockCount, b.StockCount, b.PriceUnit, b.PriceUnit},
		{b.ProductID, rakA, rakB, b.ID},
		{b.ID},
		{},
	}

	for i, stmt := range statements {
		err := quiet.Exec(stmt, args[i]...).Error
		if err != nil {
			t.Fatalf("racked takes, statement %d: %v", i, err)
		}
	}
}
