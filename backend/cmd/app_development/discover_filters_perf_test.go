//go:build perfaudit

// Performance audit for Discover's Gudang, Stok siap, Harga cross and Kategori filters (the audit-rpc-performance skill;
// discovers-warehouse-keeps-ready-stock-there, discover-ranges-are-picked, a-cross-band-keeps-a-range-that-touches-it,
// a-picked-branch-keeps-its-whole-subtree), measured through the REAL wiring: ProductDiscover asks inventory's batches
// through productStockNarrower and category_service's tree through productCategoryTree — on one probed database.
//
// Volume: perfDiscoverVolume (discover_cards_perf_test.go) — 30 000 products over 20 selling teams, 100 000 batches
// (≈ 60 000 still holding units) over 5 warehouses at unit costs Rp 1 000 – 51 000, markups 0 – 20%, 5 000 never
// stocked — plus a category tree of 170 nodes (10 branches × 4 × 3 end categories), every product filed on an end one.
//
//	go test -tags perfaudit -p 1 -run TestPerf_DiscoverFilters -v ./backend/cmd/app_development/
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

// perfDiscoverCategories seeds the tree and files every probe product on one of its 120 end categories; it returns one
// top branch (12 end categories, ≈ 3 000 products under it) and one end category (≈ 250).
func perfDiscoverCategories(t *testing.T, db *gorm.DB) (uint64, uint64) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO categories (name, parent_id) SELECT 'PD-top-' || g, NULL FROM generate_series(1, 10) g`,
		`INSERT INTO categories (name, parent_id)
		 SELECT 'PD-mid-' || p.name || '-' || g, p.id FROM categories p CROSS JOIN generate_series(1, 4) g
		 WHERE p.name LIKE 'PD-top-%'`,
		`INSERT INTO categories (name, parent_id)
		 SELECT 'PD-end-' || p.name || '-' || g, p.id FROM categories p CROSS JOIN generate_series(1, 3) g
		 WHERE p.name LIKE 'PD-mid-%'`,
		`UPDATE products p SET category_id = e.id
		 FROM (SELECT id, row_number() OVER (ORDER BY id) - 1 AS n FROM categories WHERE name LIKE 'PD-end-%') e
		 WHERE p.product_code LIKE 'DC-%' AND (p.id % 120) = e.n`,
		`ANALYZE categories`,
		`ANALYZE products`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("categories seed: %v\n%s", err, statement)
		}
	}

	var top, end uint64

	err := db.Raw(`SELECT id FROM categories WHERE name = 'PD-top-1'`).Scan(&top).Error
	if err != nil {
		t.Fatalf("top: %v", err)
	}

	err = db.Raw(`SELECT id FROM categories WHERE name LIKE 'PD-end-%' ORDER BY id LIMIT 1`).Scan(&end).Error
	if err != nil {
		t.Fatalf("end: %v", err)
	}

	return top, end
}

func TestPerf_DiscoverFilters(t *testing.T) {
	raw := san_testdb.DB(t)

	for _, table := range []string{"products", "batches", "categories"} {
		var size int64

		err := raw.Raw(`SELECT pg_relation_size(?::regclass)`, table).Scan(&size).Error
		if err != nil {
			t.Fatalf("size of %s: %v", table, err)
		}

		t.Logf("before the seed: %s = %d bytes on disk", table, size)
	}

	perfDiscoverVolume(t, raw)
	top, end := perfDiscoverCategories(t, raw)

	db, probe := san_perf.Wrap(raw)
	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), NewProductCategoryTree(db))
	ctx := context.Background()

	var discoverTeams []uint64
	for i := range 20 {
		discoverTeams = append(discoverTeams, perfDiscoverCaller+uint64(i))
	}

	byName := &productv1.ProductListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
		S:        &productv1.ProductListFilterSort_Product{Product: productv1.ProductRowSort_PRODUCT_ROW_SORT_NAME},
	}

	ready := func(lo int64, hi ...int64) *productv1.DiscoverReadyRange {
		r := &productv1.DiscoverReadyRange{Min: lo}
		if len(hi) > 0 {
			r.Max = &hi[0]
		}

		return r
	}

	cross := func(lo float64, hi ...float64) *productv1.DiscoverPriceRange {
		r := &productv1.DiscoverPriceRange{Min: lo}
		if len(hi) > 0 {
			r.Max = &hi[0]
		}

		return r
	}

	type filterCase struct {
		name string
		set  func(*productv1.ProductDiscoverRequest)
	}

	discover := func(c filterCase) *productv1.ProductDiscoverResponse {
		req := &productv1.ProductDiscoverRequest{
			TeamId:        perfDiscoverCaller,
			OwnerTeamIds:  discoverTeams,
			IncludeLocked: true,
			Page:          &commonv1.CommonPagination{Page: 1, Limit: 20},
		}
		c.set(req)

		res, err := products.ProductDiscover(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		return res.Msg
	}

	var summary strings.Builder

	summary.WriteString("\n| case | rows (total) | step medians, ms | wall median |\n|---|---|---|---|\n")

	measure := func(c filterCase) {
		first := discover(c) // warm-up

		walls := make([]time.Duration, 0, 5)
		steps := map[int][]time.Duration{}
		labels := map[int]string{}

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(func() { discover(c) })
			walls = append(walls, wall)

			for i, q := range probe.Queries() {
				steps[i] = append(steps[i], q.Duration)
				labels[i] = filterStepLabel(q.SQL)
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

		fmt.Fprintf(&summary, "| %s | %d (%d) | %s | %.1f ms |\n", c.name, len(first.GetIds()), first.GetPageInfo().GetTotalItems(),
			strings.Join(parts, " · "), float64(san_perf.Median(walls).Microseconds())/1000)

		probe.Report(t, c.name)
	}

	w := perfDiscoverWarehouse
	closed := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED

	cases := []filterCase{
		{"no filter (today's page)", func(*productv1.ProductDiscoverRequest) {}},
		{"Gudang", func(r *productv1.ProductDiscoverRequest) { r.WarehouseId = w }},
		{"Stok siap 1–10", func(r *productv1.ProductDiscoverRequest) { r.Ready = ready(1, 10) }},
		{"Stok siap 11–50", func(r *productv1.ProductDiscoverRequest) { r.Ready = ready(11, 50) }},
		{"Stok siap 10.001+ (open top)", func(r *productv1.ProductDiscoverRequest) { r.Ready = ready(10001) }},
		{"Stok siap Kosong 0–0 (complement)", func(r *productv1.ProductDiscoverRequest) { r.Ready = ready(0, 0) }},
		{"Stok siap 0–10 (complement)", func(r *productv1.ProductDiscoverRequest) { r.Ready = ready(0, 10) }},
		{"Harga cross ≤ 10rb", func(r *productv1.ProductDiscoverRequest) { r.CrossPrice = cross(0, 10000) }},
		{"Harga cross 25–50rb", func(r *productv1.ProductDiscoverRequest) { r.CrossPrice = cross(25000, 50000) }},
		{"Harga cross 500rb+ (open top)", func(r *productv1.ProductDiscoverRequest) { r.CrossPrice = cross(500000) }},
		{"Kategori, a branch (12 end categories)", func(r *productv1.ProductDiscoverRequest) { r.CategoryId = top }},
		{"Kategori, an end category", func(r *productv1.ProductDiscoverRequest) { r.CategoryId = end }},
		{"Gudang + Stok siap 1–10 + Harga cross 10–25rb", func(r *productv1.ProductDiscoverRequest) {
			r.WarehouseId = w
			r.Ready = ready(1, 10)
			r.CrossPrice = cross(10000, 25000)
		}},
		{"all four + Kunci Terkunci", func(r *productv1.ProductDiscoverRequest) {
			r.WarehouseId = w
			r.Ready = ready(1, 10)
			r.CrossPrice = cross(10000, 25000)
			r.CategoryId = top
			r.Filter = &productv1.ProductListFilter{Lock: closed}
		}},
		{"Gudang + Harga cross 10–25rb, by name, page 20", func(r *productv1.ProductDiscoverRequest) {
			r.WarehouseId = w
			r.CrossPrice = cross(10000, 25000)
			r.Sort = byName
			r.Page = &commonv1.CommonPagination{Page: 20, Limit: 20}
		}},
	}

	for _, c := range cases {
		measure(c)
	}

	t.Log(summary.String())

	// The plans of the widest asks: the shelves statement and the page statement binding its answer.
	for _, i := range []int{1, 6, 8, 13} {
		probe.Reset()
		discover(cases[i])

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "SAVEPOINT") || strings.Contains(q.SQL, "RELEASE") {
				continue
			}

			san_perf.Explain(t, raw, q.SQL)
		}
	}

	// THE CONTROL: each array literal the widest asks bind, bound to a query that does nothing with it — this host's
	// loopback cost of a big parameter, not the read's (the-id-list-stalls-on-this-loopback).
	for _, i := range []int{1, 8} {
		probe.Reset()
		discover(cases[i])

		for _, q := range probe.Queries() {
			rest := q.SQL

			for {
				at := strings.Index(rest, "'{")
				if at < 0 {
					break
				}

				rest = rest[at:]
				stop := strings.Index(rest, "}'")
				payload := rest[:stop+2]
				rest = rest[stop+2:]

				if len(payload) < 1000 {
					continue
				}

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

				t.Logf("control (%s, %s) — a %d-byte array bound to SELECT length($1): median %v", cases[i].name,
					filterStepLabel(q.SQL), len(payload), san_perf.Median(walls))
			}
		}
	}
}

// filterStepLabel names a statement by what it does, for the summary table.
func filterStepLabel(sql string) string {
	switch {
	case strings.Contains(sql, "WITH RECURSIVE"):
		return "subtree"
	case strings.Contains(sql, "WITH c AS"):
		return "closed-by-minimum"
	case strings.Contains(sql, "MAX(cross_markup_bps)"):
		return "markup-max"
	// ShelvedProducts reads the cost spread; ProductsReadyAbove only the ids (its `>` is also in the shelves' `>=`).
	case strings.Contains(sql, "batches") && !strings.Contains(sql, "MIN(price_unit)"):
		return "ready-above"
	case strings.Contains(sql, "batches"):
		return "shelves"
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
