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
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// KELUAR MASUK HARIAN AT VOLUME — ProductDailyMoves (the-warehouse-zone-is-tabs) on the inventory metrics' busy year
// (perfStockReportBackground: ≈ 1 460 000 fold rows, 20 warehouses × 30 sellers × 10 000 products, 200 000 batches — the
// MetricData.md seed) plus ONE HOT product of seller 100: every change type in all 20 warehouses on each of the last 30
// days (≈ 7 200 fold rows of its own) and 1 000 batches. Measured for the hot product and an ordinary one, every
// warehouse and one, under the custom and the generic plan (pgx prepares every statement). The bar: ≤ 5 ms
// (MetricData.md's precedent — a seller's data read of 20 products over a year, 3.1 ms).
//
//	go test -tags perfaudit -p 1 -run TestPerf_ProductDailyMoves -v ./backend/services/inventory_service/inventory_v1/
func TestPerf_ProductDailyMoves(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfStockReportBackground(t, db)

	const (
		hot      uint64 = 50_000
		ordinary uint64 = 1_234
		seller   uint64 = 100
	)

	statements := []string{
		`INSERT INTO inventory_stock_daily_changes
		     (day, warehouse_id, team_id, product_id, supplier_id, change_type, change_count, change_value)
		 SELECT CURRENT_DATE - d, 5 + w, 100, 50000, w % 5, ty,
		        CASE WHEN ty IN ('restock', 'transfer_in', 'return', 'found') THEN 5 + (d + w) % 20 ELSE -(1 + (d + w) % 3) END,
		        0
		 FROM generate_series(0, 29) d CROSS JOIN generate_series(0, 19) w
		 CROSS JOIN unnest(ARRAY['order', 'restock', 'return', 'transfer_in', 'transfer_out', 'sample', 'broken', 'lost',
		     'found', 'adjustment', 'restock_correction', 'transfer_correction']) ty
		 ON CONFLICT DO NOTHING`,
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, description)
		 SELECT 5 + (g % 20), 100, 'restock', 'perf-pdm' FROM generate_series(1, 1000) g`,
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, supplier_id, price_unit, stock_count,
		                      stock_valuation, init_stock_count, init_stock_valuation)
		 SELECT t.warehouse_id, 100, 50000, t.id, t.id % 5, 15000, t.id % 7, (t.id % 7) * 15000, 10, 150000
		 FROM inventory_transactions t WHERE t.description = 'perf-pdm'`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"inventory_stock_daily_changes", "inventory_transactions", "batches"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	var rows int64

	quiet.Raw("SELECT COUNT(*) FROM inventory_stock_daily_changes").Scan(&rows)
	t.Logf("seed: %d fold rows", rows)

	facts := fakeFacts{hot: {TeamID: seller}, ordinary: {TeamID: seller}}
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, facts, nil, nil, nil, nil)

	read := func(product, warehouse uint64) error {
		_, err := svc.ProductDailyMoves(ctxUser(41), connect.NewRequest(&inventoryv1.ProductDailyMovesRequest{
			TeamId: 200, Filter: &inventoryv1.ProductDailyMovesFilter{ProductId: product, WarehouseId: warehouse},
		}))

		return err
	}

	for range 10 {
		err := read(hot, 0)
		if err != nil {
			t.Fatalf("warm-up: %v", err)
		}
	}

	for _, plan := range []string{"auto", "force_generic_plan"} {
		err := quiet.Exec("SET LOCAL plan_cache_mode = " + plan).Error
		if err != nil {
			t.Fatalf("plan mode %s: %v", plan, err)
		}

		for _, c := range []struct {
			name               string
			product, warehouse uint64
		}{
			{"hot product, every warehouse", hot, 0},
			{"hot product, one warehouse", hot, 7},
			{"ordinary product, every warehouse", ordinary, 0},
			{"ordinary product, one warehouse", ordinary, 7},
		} {
			perfRun(t, db, probe, "ProductDailyMoves "+c.name+" ["+plan+"]", 1, func(int) error { return read(c.product, c.warehouse) })
		}
	}
}
