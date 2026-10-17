//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE BACKGROUND VOLUME for the ledger write audits (audit-rpc-performance §2). A write's cost is in its reads — the
// key lookup, the FIFO batch pick, the rack pick, the locks — and those only mean something against tables that hold
// what a busy group of warehouses will hold. Spread over 20 warehouses, Gudang 5 and 6 among them, so every filter is
// genuinely selective and the target products share their warehouse with thousands of others.
//
//	placements                10 000   500 per warehouse
//	inventory_transactions    50 000   restocks
//	inventory_transaction_items 50 000 one per transaction
//	batches                   50 000   one per transaction, 2 500 products
//	batch_logs                50 000   the mint row of each batch
//	product_placements        10 000   one per placement
//	product_placement_logs    50 000
//	idempotency_order_check   50 000   one claimed key per transaction
//	restocks / restock_items  10 000 / 50 000
//
// Set-based SQL rather than CreateInBatches: 370 000 rows through GORM would take minutes and measure nothing. Every
// row is marked `perf-bg` where the table has a free text column, so the dependent inserts find their parents.
func perfLedgerBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO placements (warehouse_id, code, name, description)
		 SELECT 1 + g % 20, 'bg-' || g, 'background', 'perf-bg' FROM generate_series(1, 10000) g`,

		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT 1 + g % 20, 2, 'restock', 1, 'perf-bg' FROM generate_series(1, 50000) g`,

		`INSERT INTO inventory_transaction_items (warehouse_id, transaction_id, product_id, product_team_id, is_owned, quantity, total)
		 SELECT t.warehouse_id, t.id, 100000 + t.id % 2500, 2, TRUE, 10, 10000
		 FROM inventory_transactions t WHERE t.description = 'perf-bg'`,

		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation)
		 SELECT t.warehouse_id, 2, 100000 + t.id % 2500, t.id, 1000, 1 + t.id % 40, (1 + t.id % 40) * 1000,
		        1 + t.id % 40, (1 + t.id % 40) * 1000
		 FROM inventory_transactions t WHERE t.description = 'perf-bg'`,

		`INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, actor_id)
		 SELECT b.warehouse_id, b.team_id, b.id, b.transaction_id, 'restock', b.stock_count, b.stock_valuation,
		        b.stock_count, b.stock_valuation, b.price_unit, 1
		 FROM batches b JOIN inventory_transactions t ON t.id = b.transaction_id AND t.description = 'perf-bg'`,

		`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		 SELECT 2, p.warehouse_id, 100000 + p.id % 2500, p.id, 10
		 FROM placements p WHERE p.description = 'perf-bg'`,

		`INSERT INTO product_placement_logs (warehouse_id, team_id, product_id, placement_id, transaction_id, change_type,
		                                     stock_change, stock_after, actor_id)
		 SELECT p.warehouse_id, 2, 100000 + p.id % 2500, p.id, t.id, 'restock', 10, 10, 1
		 FROM inventory_transactions t
		 JOIN placements p ON p.code = 'bg-' || (1 + t.id % 10000)
		 WHERE t.description = 'perf-bg'`,

		`INSERT INTO idempotency_order_check (idempotency_key, transaction_id)
		 SELECT 'bg:' || t.id, t.id FROM inventory_transactions t WHERE t.description = 'perf-bg'`,

		`INSERT INTO restocks (team_id, warehouse_id, status, finance_account_id, note)
		 SELECT 2, 1 + g % 20, 'accepted', 7, 'perf-bg' FROM generate_series(1, 10000) g`,

		`INSERT INTO restock_items (restock_id, product_id, sku, name, count, total, price_unit, received_count)
		 SELECT r.id, 100000 + k, 'SKU-BG', 'background', 10, 10000, 1000, 10
		 FROM restocks r CROSS JOIN generate_series(1, 5) k WHERE r.note = 'perf-bg'`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("background seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{
		"placements", "inventory_transactions", "inventory_transaction_items", "batches", "batch_logs",
		"product_placements", "product_placement_logs", "idempotency_order_check", "restocks", "restock_items",
	} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

// The products the audited writes move — Melati's own, so no line is borrowed and no reserve refuses it.
const perfFirstProduct uint64 = 900_001

func perfProducts(n int) []uint64 {
	ids := make([]uint64, 0, n)
	for i := range n {
		ids = append(ids, perfFirstProduct+uint64(i))
	}

	return ids
}

func perfFacts(n int) fakeFacts {
	facts := fakeFacts{}
	for _, id := range perfProducts(n) {
		facts[id] = inventory_v1.ProductFact{TeamID: otMelati, SKU: "PERF", Name: "Perf product"}
	}

	return facts
}

// perfStock gives each of the first n target products `batches` batches of `each` units in the warehouse, the batches
// rotating over the racks — so a take has a real FIFO choice and a rack pick has more than one rack to weigh.
func perfStock(t *testing.T, db *gorm.DB, warehouse uint64, n, batches int, each int64, racks []uint64) {
	t.Helper()

	for _, product := range perfProducts(n) {
		for b := range batches {
			stockOnLedger(t, db, warehouse, otMelati, product, racks[b%len(racks)], each, 1000+float64(b))
		}
	}

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	for _, table := range []string{"batches", "product_placements", "batch_logs", "product_placement_logs"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

// perfRun measures one size of one write: a warm-up call (schema reflection and the pool are not the RPC's cost), then
// five timed calls, each a FRESH write — `call` gets the run number so it can use a new key or a new record. It logs
// every run and the median, and at the end the query table and the plan of the slowest read. Returns the query count of
// the last run, so the caller can compare sizes: a count that moves with the number of lines is an N+1.
func perfRun(t *testing.T, db *gorm.DB, probe *san_perf.Probe, name string, size int, call func(run int) error) int {
	t.Helper()

	err := call(0)
	if err != nil {
		t.Fatalf("%s warm-up (lines=%d): %v", name, size, err)
	}

	walls := make([]time.Duration, 0, 5)

	for run := 1; run <= 5; run++ {
		probe.Reset()

		var callErr error

		wall, dbTime := probe.Measure(func() {
			callErr = call(run)
		})
		if callErr != nil {
			t.Fatalf("%s (lines=%d, run %d): %v", name, size, run, callErr)
		}

		walls = append(walls, wall)
		t.Logf("%s lines=%d wall=%v db=%v go=%v queries=%d", name, size, wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("%s lines=%d MEDIAN wall %v", name, size, san_perf.Median(walls))

	count := probe.Count()
	probe.Report(t, name)

	// EXPLAIN only a read: EXPLAIN ANALYZE runs the statement, and a write explained here would move the stock the next
	// size measures against.
	var slowest *san_perf.Query

	for _, q := range probe.Queries() {
		if !strings.HasPrefix(strings.TrimSpace(strings.ToUpper(q.SQL)), "SELECT") {
			continue
		}

		if slowest == nil || q.Duration > slowest.Duration {
			copied := q
			slowest = &copied
		}
	}

	if slowest != nil {
		san_perf.Explain(t, db, slowest.SQL)
	}

	return count
}
