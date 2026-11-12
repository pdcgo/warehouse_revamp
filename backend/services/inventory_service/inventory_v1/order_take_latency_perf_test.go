//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE ORDER TAKE'S LATENCY, before and after Ready stock's fold (docs/business/analytic/rpc_provide_decision.md —
// ready-stock-is-folded-in-the-stock-changes-own-step: "the cost — measured on the order take before and after,
// recorded in its perf audit"). Many takes rather than perfRun's five, so the median AND the 95th percentile mean
// something: 200 one-line takes, then 60 twenty-line takes, each a fresh key, against the ledger background volume and
// — once the table exists — a year of daily change rows (perfChangesBackground).
//
// ⚠ Inside ONE test transaction every take's UPDATE of a hot row keeps the old version alive (its own subtransaction's),
// so the chains grow with every take — the batches' and, after the fold, the report rows' alike. That over-states a hot
// row's cost; TestPerf_OrderTakeLatency_Committed is the number the audit records.
func TestPerf_OrderTakeLatency(t *testing.T) {
	takeLatency(t, san_testdb.DB(t))
}

// takeLatencyTables is every table the committed probe writes, children first; one absent (before the fold, the report
// tables) is skipped.
var takeLatencyTables = []string{
	"inventory_stock_daily_changes", "inventory_door_daily_reports", "idempotency_order_check", "inventory_transaction_items",
	"batch_price_logs", "batch_logs", "product_placement_logs", "product_placements", "batches", "restock_problem_items",
	"restock_logs", "restock_items", "restocks", "inventory_transactions", "placements",
}

// THE SAME, COMMITTED: every take its own committed transaction, as in production — the old row versions die with it
// and are pruned as they would be. It DELETEs from the shared ledger tables before and after: run it alone (-p 1), never
// beside another package's tests.
func TestPerf_OrderTakeLatency_Committed(t *testing.T) {
	db := san_testdb.Pool(t)

	clean := func() {
		for _, table := range takeLatencyTables {
			var exists bool

			db.Raw(`SELECT to_regclass(?) IS NOT NULL`, table).Scan(&exists)
			if !exists {
				continue
			}

			err := db.Exec(`DELETE FROM ` + table).Error
			if err != nil {
				t.Fatalf("clean %s: %v", table, err)
			}
		}
	}

	clean()
	t.Cleanup(clean)

	takeLatency(t, db)
}

func takeLatency(t *testing.T, db *gorm.DB) {
	t.Helper()

	perfLedgerBackground(t, db)
	perfChangesBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil)
	racks := []uint64{newRack(t, svc, otWarehouse, "lat-a"), newRack(t, svc, otWarehouse, "lat-b"), newRack(t, svc, otWarehouse, "lat-c")}
	perfStock(t, db, otWarehouse, 20, 10, 100, racks)

	for _, run := range []struct{ size, takes int }{{1, 200}, {20, 60}} {
		lines := make([]*inventoryv1.OrderTransactionLine, 0, run.size)
		for _, product := range perfProducts(run.size) {
			lines = append(lines, line(product, 1))
		}

		take := func(n int) {
			_, err := svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
				TeamId: otMelati, IdempotencyKey: fmt.Sprintf("lat:%d:%d", run.size, n), WarehouseId: otWarehouse, Lines: lines,
			}))
			if err != nil {
				t.Fatalf("take lines=%d #%d: %v", run.size, n, err)
			}
		}

		take(0) // warm-up: schema reflection and the pool are not the take's cost

		walls := make([]time.Duration, 0, run.takes)
		for n := 1; n <= run.takes; n++ {
			start := time.Now()
			take(n)
			walls = append(walls, time.Since(start))
		}

		slices.Sort(walls)
		t.Logf("ORDER TAKE lines=%d takes=%d median=%v p95=%v min=%v max=%v", run.size, run.takes,
			walls[len(walls)/2], walls[len(walls)*95/100], walls[0], walls[len(walls)-1])
	}
}

// perfChangesBackground gives `inventory_stock_daily_changes` a year of daily rows over the background's 2 500 products
// in 20 warehouses (≈ 450 000 rows: every product moves on about one day in two) — the index the take's upsert walks.
// Nothing when the table does not exist yet (the before-measurement).
func perfChangesBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	var exists bool

	err := quiet.Raw(`SELECT to_regclass('inventory_stock_daily_changes') IS NOT NULL`).Scan(&exists).Error
	if err != nil {
		t.Fatalf("look for the change table: %v", err)
	}

	if !exists {
		t.Logf("inventory_stock_daily_changes absent — measuring the take WITHOUT the fold")

		return
	}

	err = quiet.Exec(`
		INSERT INTO inventory_stock_daily_changes
		    (day, warehouse_id, team_id, product_id, supplier_id, change_type, change_count, change_value)
		SELECT CURRENT_DATE - d, 1 + p % 20, 2, 100000 + p, 0, 'order', -1, -1000
		FROM generate_series(1, 365) d CROSS JOIN generate_series(0, 2499) p
		WHERE (d + p) % 2 = 0`).Error
	if err != nil {
		t.Fatalf("change background: %v", err)
	}

	err = quiet.Exec(`ANALYZE inventory_stock_daily_changes`).Error
	if err != nil {
		t.Fatalf("analyze changes: %v", err)
	}

	t.Logf("inventory_stock_daily_changes seeded — measuring the take WITH the fold")
}
