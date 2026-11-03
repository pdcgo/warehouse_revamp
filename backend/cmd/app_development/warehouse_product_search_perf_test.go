//go:build perfaudit

// Performance audit for WarehouseProductSearch (the audit-rpc-performance skill) — the warehouse's product picker
// (a-warehouse-picks-only-what-it-has-held), measured through the REAL wiring: inventory's held-ids read, then
// product_service's SearchAmong through the composition root's reader, on one probed database.
//
//	go test -tags perfaudit -p 1 -run TestPerf_WarehouseProductSearch -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

const (
	// Holds 5 000 products — the size the decision was measured at — four batches each.
	perfPickWarehouse uint64 = 9_100_001
	// Holds 10 000, three batches each: the same read at twice the set.
	perfPickBigWarehouse uint64 = 9_100_002
)

// perfPickerVolume seeds the catalogue and the batch ledger:
//
//	products   30 000   40 selling teams, names from 10 garments × 10 colours, so "kaos" matches one in ten
//	batches    70 000   W1 5 000 products × 4 · W2 10 000 products × 3 · 20 000 over 18 other warehouses
//
// Set-based SQL, every row marked so its dependents find it. One inventory transaction carries every batch — the FK
// needs a parent, and the read never joins it.
func perfPickerVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO products (team_id, product_code, name, archived)
		 SELECT 9200000 + g % 40, 'PF-' || g,
		        (ARRAY['Kaos','Kemeja','Celana','Jaket','Topi','Sepatu','Tas','Sarung','Hijab','Rok'])[1 + g % 10] || ' ' ||
		        (ARRAY['Polos','Hitam','Putih','Merah','Biru','Hijau','Kuning','Abu','Navy','Coklat'])[1 + (g / 10) % 10] ||
		        ' ' || g,
		        g % 50 = 0
		 FROM generate_series(1, 30000) g`,

		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 VALUES (9100001, 9200000, 'restock', 1, 'perf-picker')`,

		// W1: the first 5 000 products, four batches each, one in four emptied.
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation)
		 SELECT 9100001, p.team_id, p.id, t.id, 1000, CASE WHEN k = 1 THEN 0 ELSE 5 END, 5000, 5, 5000
		 FROM (SELECT id, team_id, row_number() OVER (ORDER BY id) AS n FROM products WHERE product_code LIKE 'PF-%') p
		 CROSS JOIN generate_series(1, 4) k
		 CROSS JOIN (SELECT id FROM inventory_transactions WHERE description = 'perf-picker') t
		 WHERE p.n <= 5000`,

		// W2: products 5 001 – 15 000, three batches each.
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation)
		 SELECT 9100002, p.team_id, p.id, t.id, 1000, 5, 5000, 5, 5000
		 FROM (SELECT id, team_id, row_number() OVER (ORDER BY id) AS n FROM products WHERE product_code LIKE 'PF-%') p
		 CROSS JOIN generate_series(1, 3) k
		 CROSS JOIN (SELECT id FROM inventory_transactions WHERE description = 'perf-picker') t
		 WHERE p.n > 5000 AND p.n <= 15000`,

		// 18 other warehouses: 20 000 batches over the whole catalogue.
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation)
		 SELECT 9100003 + p.n % 18, p.team_id, p.id, t.id, 1000, 5, 5000, 5, 5000
		 FROM (SELECT id, team_id, row_number() OVER (ORDER BY id) AS n FROM products WHERE product_code LIKE 'PF-%') p
		 CROSS JOIN (SELECT id FROM inventory_transactions WHERE description = 'perf-picker') t
		 WHERE p.n <= 20000`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("picker seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"products", "inventory_transactions", "batches"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

func TestPerf_WarehouseProductSearch(t *testing.T) {
	raw := san_testdb.DB(t)
	perfPickerVolume(t, raw)

	db, probe := san_perf.Wrap(raw)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(product_v1.NewService(db, nil, nil)))
	ctx := context.Background()

	search := func(warehouse uint64, q string, limit uint32) *inventoryv1.WarehouseProductSearchResponse {
		res, err := inventory.WarehouseProductSearch(ctx, connect.NewRequest(&inventoryv1.WarehouseProductSearchRequest{
			WarehouseId: warehouse,
			Filter:      &inventoryv1.WarehouseProductSearchFilter{Q: q},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: limit},
		}))
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}

		return res.Msg
	}

	cases := []struct {
		warehouse uint64
		held      string
		q         string
		limit     uint32
	}{
		{perfPickWarehouse, "5 000", "kaos", 10},
		{perfPickWarehouse, "5 000", "kaos", 200},
		{perfPickWarehouse, "5 000", "kaos polos", 10},
		{perfPickWarehouse, "5 000", "PF-123", 10},
		{perfPickWarehouse, "5 000", "zzzz", 10},
		{perfPickBigWarehouse, "10 000", "kaos", 10},
		{perfPickBigWarehouse, "10 000", "kaos", 200},
	}

	for _, c := range cases {
		name := fmt.Sprintf("held %s · q=%q · limit %d", c.held, c.q, c.limit)

		// Warm-up: schema reflection and the pool are not the RPC's cost.
		first := search(c.warehouse, c.q, c.limit)

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				search(c.warehouse, c.q, c.limit)
			})

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: median wall %v — %d of %d matches on the page", name, san_perf.Median(walls),
			len(first.GetIds()), first.GetPageInfo().GetTotalItems())
		probe.Report(t, name)
	}

	// The plans, at the 5 000-held warehouse and the common term.
	probe.Reset()
	search(perfPickWarehouse, "kaos", 10)

	for _, q := range probe.Queries() {
		san_perf.Explain(t, raw, q.SQL)
	}

	// THE CONTROL: the same held-id list bound to a query that does nothing with it. Whatever this takes is the cost of
	// carrying the list to Postgres, not of searching it — on a Docker Desktop loopback some payload sizes stall.
	for _, warehouse := range []uint64{perfPickWarehouse, perfPickBigWarehouse} {
		var ids []uint64

		err := raw.Raw(`SELECT DISTINCT product_id FROM batches WHERE warehouse_id = ?`, warehouse).Scan(&ids).Error
		if err != nil {
			t.Fatalf("held ids: %v", err)
		}

		list := fmt.Sprint(ids)
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			var n int64

			start := time.Now()

			err = raw.Raw(`SELECT length(?)`, list).Scan(&n).Error
			if err != nil {
				t.Fatalf("control: %v", err)
			}

			walls = append(walls, time.Since(start))
		}

		t.Logf("control — %d ids (%d bytes) bound to SELECT length($1): median %v", len(ids), len(list), san_perf.Median(walls))
	}
}
