//go:build perfaudit

// Performance audit for ProductList's Kunci and Umur stok filters (the audit-rpc-performance skill;
// lock-and-stock-age-filter-ahead-of-the-contract), measured through the REAL wiring: product_service's ProductList asks
// inventory's batches through the composition root's productStockNarrower, on one probed database.
//
// Volume: the probed team owns 30 000 products and 100 000 batches (60 000 still holding units) over 5 warehouses,
// arrived over the last 180 days — the worst case for one team's list, since every narrowing reads that team's whole
// stock. One product in three is a minimum product (≈ 9 000 of them; one in ten is always-locked), and 5 000 products
// were never stocked. Ten other teams hold 10 000 products and 30 000 batches beside it.
//
//	go test -tags perfaudit -p 1 -run TestPerf_ProductListFilters -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

const (
	perfListTeam      uint64 = 9_500_001
	perfListWarehouse uint64 = 9_510_001
)

func perfListVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO products (team_id, product_code, name, archived, cross_locked, reserved_stock)
		 SELECT 9500001, 'PL-' || g,
		        (ARRAY['Kaos','Kemeja','Celana','Jaket','Topi','Sepatu','Tas','Sarung','Hijab','Rok'])[1 + g % 10] || ' ' ||
		        (ARRAY['Polos','Hitam','Putih','Merah','Biru','Hijau','Kuning','Abu','Navy','Coklat'])[1 + (g / 10) % 10] ||
		        ' ' || g,
		        FALSE, g % 10 = 0, CASE WHEN g % 3 = 0 THEN 1 + g % 40 ELSE 0 END
		 FROM generate_series(1, 30000) g`,

		`INSERT INTO products (team_id, product_code, name, archived, cross_locked, reserved_stock)
		 SELECT 9500002 + g % 10, 'PLB-' || g, 'Barang ' || g, FALSE, FALSE, CASE WHEN g % 3 = 0 THEN 5 ELSE 0 END
		 FROM generate_series(1, 10000) g`,

		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 VALUES (9510001, 9500001, 'restock', 1, 'perf-list-filters')`,

		// The probed team: products 1 – 25 000, four batches each over 5 warehouses; two in five emptied; arrived 0 – 179
		// days ago.
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, created_at)
		 SELECT 9510001 + (p.n + k) % 5, p.team_id, p.id, t.id, 1000,
		        CASE WHEN (p.n * 7 + k) % 5 < 2 THEN 0 ELSE 1 + (p.n + k) % 12 END, 5000, 12, 12000,
		        NOW() - ((p.n * 13 + k * 37) % 180) * INTERVAL '1 day' - INTERVAL '1 hour'
		 FROM (SELECT id, team_id, row_number() OVER (ORDER BY id) AS n FROM products WHERE product_code LIKE 'PL-%') p
		 CROSS JOIN generate_series(1, 4) k
		 CROSS JOIN (SELECT id FROM inventory_transactions WHERE description = 'perf-list-filters') t
		 WHERE p.n <= 25000`,

		// The ten other teams: three batches per product.
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, created_at)
		 SELECT 9510001 + (p.n + k) % 5, p.team_id, p.id, t.id, 1000,
		        CASE WHEN (p.n + k) % 5 < 2 THEN 0 ELSE 4 END, 4000, 4, 4000,
		        NOW() - ((p.n * 11 + k * 29) % 180) * INTERVAL '1 day'
		 FROM (SELECT id, team_id, row_number() OVER (ORDER BY id) AS n FROM products WHERE product_code LIKE 'PLB-%') p
		 CROSS JOIN generate_series(1, 3) k
		 CROSS JOIN (SELECT id FROM inventory_transactions WHERE description = 'perf-list-filters') t`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("list filters seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"products", "inventory_transactions", "batches"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

func TestPerf_ProductListFilters(t *testing.T) {
	raw := san_testdb.DB(t)

	// A run is only worth quoting on clean tables: a killed run's seed sits as dead rows (revamp-build-passes).
	for _, table := range []string{"products", "batches"} {
		var size int64

		err := raw.Raw(`SELECT pg_relation_size(?::regclass)`, table).Scan(&size).Error
		if err != nil {
			t.Fatalf("size of %s: %v", table, err)
		}

		t.Logf("before the seed: %s = %d bytes on disk", table, size)
	}

	perfListVolume(t, raw)

	db, probe := san_perf.Wrap(raw)
	svc := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), nil)
	ctx := context.Background()

	byName := &productv1.ProductListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
		S:        &productv1.ProductListFilterSort_Product{Product: productv1.ProductRowSort_PRODUCT_ROW_SORT_NAME},
	}

	type probeCase struct {
		name   string
		filter *productv1.ProductListFilter
		lens   uint64
		sort   *productv1.ProductListFilterSort
		page   uint32
	}

	open := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_OPEN
	minimum := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_MINIMUM
	always := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_ALWAYS
	now := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW

	cases := []probeCase{
		{"no filter (today's list)", nil, 0, nil, 1},
		{"Terbuka", &productv1.ProductListFilter{Lock: open}, 0, nil, 1},
		{"Stok minimum", &productv1.ProductListFilter{Lock: minimum}, 0, nil, 1},
		{"Selalu dikunci", &productv1.ProductListFilter{Lock: always}, 0, nil, 1},
		{"Terkunci sekarang", &productv1.ProductListFilter{Lock: now}, 0, nil, 1},
		{"Terkunci sekarang, by name, page 20", &productv1.ProductListFilter{Lock: now}, 0, byName, 20},
		{"Terkunci sekarang + q=kaos", &productv1.ProductListFilter{Lock: now, Q: "kaos"}, 0, nil, 1},
		{"Umur 30+", &productv1.ProductListFilter{StockAgeMinDays: 30}, 0, nil, 1},
		{"Umur 60+", &productv1.ProductListFilter{StockAgeMinDays: 60}, 0, nil, 1},
		{"Umur 90+", &productv1.ProductListFilter{StockAgeMinDays: 90}, 0, nil, 1},
		{"Umur 90+, by name, page 20", &productv1.ProductListFilter{StockAgeMinDays: 90}, 0, byName, 20},
		{"Umur 60+ in one warehouse", &productv1.ProductListFilter{StockAgeMinDays: 60}, perfListWarehouse, nil, 1},
		{"Umur 30+ + q=kaos", &productv1.ProductListFilter{StockAgeMinDays: 30, Q: "kaos"}, 0, nil, 1},
		{"Umur 60+ + Terkunci sekarang", &productv1.ProductListFilter{StockAgeMinDays: 60, Lock: now}, 0, nil, 1},
	}

	list := func(c probeCase) *productv1.ProductListResponse {
		res, err := svc.ProductList(ctx, connect.NewRequest(&productv1.ProductListRequest{
			TeamId:           perfListTeam,
			Filter:           c.filter,
			StockWarehouseId: c.lens,
			Sort:             c.sort,
			Page:             &commonv1.CommonPagination{Page: c.page, Limit: 20},
		}))
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		return res.Msg
	}

	var summary strings.Builder

	summary.WriteString("\n| case | rows (total) | step medians, ms | wall median |\n|---|---|---|---|\n")

	for _, c := range cases {
		first := list(c) // warm-up: schema reflection and the pool are not the RPC's cost

		walls := make([]time.Duration, 0, 5)
		steps := map[int][]time.Duration{}
		labels := map[int]string{}

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(func() { list(c) })
			walls = append(walls, wall)

			for i, q := range probe.Queries() {
				steps[i] = append(steps[i], q.Duration)
				labels[i] = stepLabel(q.SQL)
			}
		}

		keys := make([]int, 0, len(steps))
		for i := range steps {
			keys = append(keys, i)
		}

		sort.Ints(keys)

		parts := make([]string, 0, len(keys))
		for _, i := range keys {
			parts = append(parts, fmt.Sprintf("%s %.1f", labels[i], float64(san_perf.Median(steps[i]).Microseconds())/1000))
		}

		fmt.Fprintf(&summary, "| %s | %d (%d) | %s | %.1f ms |\n", c.name, len(first.GetIds()),
			first.GetPageInfo().GetTotalItems(), strings.Join(parts, " · "),
			float64(san_perf.Median(walls).Microseconds())/1000)

		probe.Report(t, c.name)
	}

	t.Log(summary.String())

	// The plans of the two seam statements and the narrowed count.
	for _, c := range []probeCase{cases[4], cases[8], cases[11], cases[13]} {
		probe.Reset()
		list(c)

		for _, q := range probe.Queries() {
			san_perf.Explain(t, raw, q.SQL)
		}
	}

	// THE CONTROL: the id lists the narrowing carries, bound to a query that does nothing with them — this host's
	// loopback cost of a big parameter, not the read's (the-id-list-stalls-on-this-loopback).
	for _, c := range []probeCase{cases[4], cases[7]} {
		probe.Reset()
		list(c)

		for _, q := range probe.Queries() {
			if !strings.Contains(q.SQL, "ANY('{") && !strings.Contains(q.SQL, "unnest(CAST('{") {
				continue
			}

			payload := q.SQL[strings.Index(q.SQL, "'{"):]
			payload = payload[:strings.Index(payload, "}'")+2]

			walls := make([]time.Duration, 0, 5)

			for range 5 {
				var n int64

				start := time.Now()

				err := raw.Raw(`SELECT length(?)`, payload).Scan(&n).Error
				if err != nil {
					t.Fatalf("control: %v", err)
				}

				walls = append(walls, time.Since(start))
			}

			t.Logf("control (%s) — a %d-byte id array bound to SELECT length($1): median %v", c.name, len(payload), san_perf.Median(walls))
		}
	}
}

// stepLabel names a statement by what it does, for the summary table.
func stepLabel(sql string) string {
	switch {
	case strings.Contains(sql, "WITH c AS"):
		return "closed-by-minimum"
	case strings.Contains(sql, "FROM \"batches\"") || strings.Contains(sql, "FROM batches"):
		return "aged-ids"
	case strings.Contains(sql, "SELECT id, team_id, reserved_stock"):
		return "candidates"
	case strings.Contains(sql, "OVER ()"):
		return "page+count"
	case strings.Contains(sql, "count(*)"):
		return "count"
	default:
		return "page"
	}
}
