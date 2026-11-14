//go:build perfaudit

// Performance audit for Discover's card figures and its Kunci filter (the audit-rpc-performance skill;
// a-discover-card-shows-its-stock, discover-filters-by-lock), measured through the REAL wiring: ProductDiscover asks
// inventory's batches through productStockNarrower, and inventory's DiscoverStockByIds asks product_service for the
// owners and markups through inventoryProductReader — on one probed database.
//
// Volume: 30 000 products over 20 selling teams (Discover reads every team's), 100 000 batches (≈ 60 000 still holding
// units) over 5 warehouses at varied unit costs, 20 000 restocks of one line each (2 000 still on their way). One
// product in three keeps a minimum (≈ 9 000 minimum products — every one a Kunci candidate), one in ten is locked, and
// 5 000 were never stocked.
//
//	go test -tags perfaudit -p 1 -run TestPerf_DiscoverCards -v ./backend/cmd/app_development/
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
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

const (
	perfDiscoverCaller    uint64 = 9_600_001
	perfDiscoverWarehouse uint64 = 9_610_001
)

func perfDiscoverVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO products (team_id, product_code, name, archived, cross_locked, reserved_stock, cross_markup_bps)
		 SELECT 9600001 + g % 20, 'DC-' || g,
		        (ARRAY['Kaos','Kemeja','Celana','Jaket','Topi','Sepatu','Tas','Sarung','Hijab','Rok'])[1 + g % 10] || ' ' ||
		        (ARRAY['Polos','Hitam','Putih','Merah','Biru','Hijau','Kuning','Abu','Navy','Coklat'])[1 + (g / 10) % 10] ||
		        ' ' || g,
		        FALSE, g % 10 = 0, CASE WHEN g % 3 = 0 THEN 1 + g % 40 ELSE 0 END, (g % 5) * 500
		 FROM generate_series(1, 30000) g`,

		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 VALUES (9610001, 9600001, 'restock', 1, 'perf-discover-cards')`,

		// Products 1 – 25 000: four batches each over 5 warehouses at four costs; two in five emptied.
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, created_at)
		 SELECT 9610001 + (p.n + k) % 5, p.team_id, p.id, t.id, 1000 + ((p.n * 37 + k * 500) % 50000),
		        CASE WHEN (p.n * 7 + k) % 5 < 2 THEN 0 ELSE 1 + (p.n + k) % 12 END, 5000, 12, 12000,
		        NOW() - ((p.n * 13 + k * 37) % 180) * INTERVAL '1 day'
		 FROM (SELECT id, team_id, row_number() OVER (ORDER BY id) AS n FROM products WHERE product_code LIKE 'DC-%') p
		 CROSS JOIN generate_series(1, 4) k
		 CROSS JOIN (SELECT id FROM inventory_transactions WHERE description = 'perf-discover-cards') t
		 WHERE p.n <= 25000`,

		// 20 000 restocks, one line each; one in ten still ongoing, one in ten arrived — on their way.
		`INSERT INTO restocks (team_id, warehouse_id, status, note)
		 SELECT p.team_id, 9610001 + p.n % 5,
		        CASE WHEN p.n % 10 = 0 THEN 'ongoing' WHEN p.n % 10 = 1 THEN 'arrived' ELSE 'accepted' END,
		        'perf-discover-cards ' || p.id
		 FROM (SELECT id, team_id, row_number() OVER (ORDER BY id) AS n FROM products WHERE product_code LIKE 'DC-%') p
		 WHERE p.n <= 20000`,

		`INSERT INTO restock_items (restock_id, product_id, product_code, name, count, total, price_unit)
		 SELECT r.id, split_part(r.note, ' ', 2)::bigint, 'DC', 'line', 5, 50000, 10000
		 FROM restocks r
		 WHERE r.note LIKE 'perf-discover-cards %'`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("discover cards seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"products", "inventory_transactions", "batches", "restocks", "restock_items"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

func TestPerf_DiscoverCards(t *testing.T) {
	raw := san_testdb.DB(t)

	// A run is only worth quoting on clean tables: a killed run's seed sits as dead rows (revamp-build-passes).
	for _, table := range []string{"products", "batches", "restocks", "restock_items"} {
		var size int64

		err := raw.Raw(`SELECT pg_relation_size(?::regclass)`, table).Scan(&size).Error
		if err != nil {
			t.Fatalf("size of %s: %v", table, err)
		}

		t.Logf("before the seed: %s = %d bytes on disk", table, size)
	}

	perfDiscoverVolume(t, raw)

	db, probe := san_perf.Wrap(raw)
	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), nil)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(products), nil, nil)
	ctx := context.Background()

	var discoverTeams []uint64
	for i := range 20 {
		discoverTeams = append(discoverTeams, perfDiscoverCaller+uint64(i))
	}

	byName := &productv1.ProductListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
		S:        &productv1.ProductListFilterSort_Product{Product: productv1.ProductRowSort_PRODUCT_ROW_SORT_NAME},
	}

	closed := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED
	orderable := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_ORDERABLE

	type discoverCase struct {
		name     string
		lock     productv1.ProductLockFilter
		q        string
		sort     *productv1.ProductListFilterSort
		page     uint32
		hideMine bool
	}

	discover := func(c discoverCase, limit uint32) *productv1.ProductDiscoverResponse {
		res, err := products.ProductDiscover(ctx, connect.NewRequest(&productv1.ProductDiscoverRequest{
			TeamId:         perfDiscoverCaller,
			Filter:         &productv1.ProductListFilter{Lock: c.lock, Q: c.q},
			Sort:           c.sort,
			ExcludeOwnTeam: c.hideMine,
			// The probe's own 20 teams — the test database may hold other suites' products.
			OwnerTeamIds:  discoverTeams,
			IncludeLocked: true,
			Page:          &commonv1.CommonPagination{Page: c.page, Limit: limit},
		}))
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		return res.Msg
	}

	cards := func(ids []uint64, warehouse uint64) *inventoryv1.DiscoverStockByIdsResponse {
		res, err := inventory.DiscoverStockByIds(ctx, connect.NewRequest(&inventoryv1.DiscoverStockByIdsRequest{
			TeamId: perfDiscoverCaller, ProductIds: ids, WarehouseId: warehouse,
		}))
		if err != nil {
			t.Fatalf("DiscoverStockByIds(%d ids, warehouse %d): %v", len(ids), warehouse, err)
		}

		return res.Msg
	}

	var summary strings.Builder

	summary.WriteString("\n| case | rows (total) | step medians, ms | wall median |\n|---|---|---|---|\n")

	measure := func(name string, rows, total int, call func()) {
		walls := make([]time.Duration, 0, 5)
		steps := map[int][]time.Duration{}
		labels := map[int]string{}

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(call)
			walls = append(walls, wall)

			for i, q := range probe.Queries() {
				steps[i] = append(steps[i], q.Duration)
				labels[i] = discoverStepLabel(q.SQL)
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

		fmt.Fprintf(&summary, "| %s | %d (%d) | %s | %.1f ms |\n", name, rows, total, strings.Join(parts, " · "),
			float64(san_perf.Median(walls).Microseconds())/1000)

		probe.Report(t, name)
	}

	discoverCases := []discoverCase{
		{"Discover, no Kunci (today's page)", 0, "", nil, 1, false},
		{"Kunci Terkunci", closed, "", nil, 1, false},
		{"Kunci Terbuka", orderable, "", nil, 1, false},
		{"Kunci Terkunci, by name, page 20", closed, "", byName, 20, false},
		{"Kunci Terbuka + q=kaos", orderable, "kaos", nil, 1, false},
		{"Kunci Terkunci + hide mine", closed, "", nil, 1, true},
	}

	for _, c := range discoverCases {
		first := discover(c, 20) // warm-up: schema reflection and the pool are not the RPC's cost
		measure("ProductDiscover · "+c.name, len(first.GetIds()), int(first.GetPageInfo().GetTotalItems()), func() { discover(c, 20) })
	}

	// The card figures for one page: 20 ids (the page's default) and 50 (its largest), every warehouse and one. Pages by
	// name, so the cards hold stock — the newest 5 000 products were never stocked, and a page of them reads no batch.
	byNamePage := discoverCase{"by name", 0, "", byName, 1, false}
	page20 := discover(byNamePage, 20).GetIds()
	page50 := discover(byNamePage, 50).GetIds()

	stocked := 0
	for _, item := range cards(page50, 0).GetItems() {
		if item.GetCrossKnown() {
			stocked++
		}
	}

	t.Logf("the 50-card page: %d of 50 hold stock", stocked)

	for _, c := range []struct {
		name      string
		ids       []uint64
		warehouse uint64
	}{
		{"DiscoverStockByIds · 20 ids, every warehouse", page20, 0},
		{"DiscoverStockByIds · 50 ids, every warehouse", page50, 0},
		{"DiscoverStockByIds · 20 ids, one warehouse", page20, perfDiscoverWarehouse},
	} {
		cards(c.ids, c.warehouse)
		measure(c.name, len(c.ids), len(c.ids), func() { cards(c.ids, c.warehouse) })
	}

	// THE PAGE as the screen reads it: the grid, then its card figures — Kunci Terkunci, 20 a page.
	measure("the page · Terkunci grid + its card figures", 20, 0, func() {
		res := discover(discoverCases[1], 20)
		cards(res.GetIds(), 0)
	})

	t.Log(summary.String())

	// The plans: the Kunci statements and the card figures' two statements.
	for _, call := range []func(){
		func() { discover(discoverCases[1], 20) },
		func() { cards(page20, 0) },
		func() { cards(page20, perfDiscoverWarehouse) },
	} {
		probe.Reset()
		call()

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "SAVEPOINT") || strings.Contains(q.SQL, "RELEASE") {
				continue
			}

			san_perf.Explain(t, raw, q.SQL)
		}
	}

	// THE CONTROL: the id lists Kunci binds, bound to a query that does nothing with them — this host's loopback cost of
	// a big parameter, not the read's (the-id-list-stalls-on-this-loopback).
	probe.Reset()
	discover(discoverCases[1], 20)

	for _, q := range probe.Queries() {
		if !strings.Contains(q.SQL, "ANY(CAST('{") && !strings.Contains(q.SQL, "unnest(CAST('{") {
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

		t.Logf("control (%s) — a %d-byte id array bound to SELECT length($1): median %v", discoverStepLabel(q.SQL),
			len(payload), san_perf.Median(walls))
	}
}

// discoverStepLabel names a statement by what it does, for the summary table.
func discoverStepLabel(sql string) string {
	switch {
	case strings.Contains(sql, "restock_items"):
		return "on-its-way"
	case strings.Contains(sql, "WITH c AS") && strings.Contains(sql, "total_ready"):
		return "shelves"
	case strings.Contains(sql, "WITH c AS"):
		return "closed-by-minimum"
	case strings.Contains(sql, "SELECT id, team_id, reserved_stock"):
		return "candidates"
	case strings.Contains(sql, "OVER ()"):
		return "page+count"
	case strings.Contains(sql, "count(*)"):
		return "count"
	case strings.Contains(sql, "LIMIT"):
		return "page"
	case strings.Contains(sql, "\"id\" IN") || strings.Contains(sql, "id IN"):
		return "facts"
	default:
		return "page"
	}
}
