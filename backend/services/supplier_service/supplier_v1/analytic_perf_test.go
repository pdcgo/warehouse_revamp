//go:build perfaudit

// The supplier's FIGURES — MetricSearch and MetricData, the two reads of `metrics/suppliers`, and the fold that writes
// them (FoldHandler). One test per RPC; run them ONE AT A TIME (a rolled-back 500k-row seed leaves dead rows that bloat
// the next test's indexes):
//
//	go test -tags perfaudit -run TestPerf_MetricSearch$ -v ./backend/services/supplier_service/supplier_v1/
//
// Volumes: `suppliers` 2 000 (8 selling teams, every 20th soft-deleted), `supplier_channels` 3 a supplier (6 000,
// every 20th soft-deleted), 10 000 products over the same 8 teams. Each product is bought from ONE supplier, drawn
// with a square skew (supplier #1 sells ~220 products, the median ~4), and restocked on ~1 day in 7 —
// `supplier_product_daily_reports` ≈ 520 000 rows over 365 days, inserted in day order as the fold writes them.
//
// Knobs: PERF_FIG_YEARS=n seeds n years at the same density (the growth check). PERF_PLAN_CACHE=custom|generic pins
// the server's plan cache. PERF_CASE=<substring> runs one case alone. PERF_REPORT=1 prints the per-statement table.
//
// Findings: audits/services/supplier_service/performances/ — the AnalyticGroupSearch / AnalyticGroupMetric reports
// audited the reads these two replaced; their plan-cache finding (dates as literals) is carried in `window`.
package supplier_v1_test

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

const (
	figSuppliers                = 2_000
	figStoresPerSupplier        = 3
	figProducts                 = 10_000
	figTeams                    = 8
	figTeamBase          uint64 = 60_000
	figProductBase       uint64 = 900_000
	// A product is restocked on ~1 day in figEvery.
	figEvery = 7
	// The last seeded day — every window ends here.
	figLastDay = "2026-10-06"
)

type figBook struct {
	perfBook

	top, median         uint64 // the supplier with the most rows, and the median one
	topRows, medianRows int64
	topProducts         []uint64 // the top supplier's products of figTeamBase — the fold's lines
	rows                int64
	years               int
}

func figDay(back int) string {
	last, err := time.Parse(dateLayoutTest, figLastDay)
	if err != nil {
		panic(err)
	}

	return last.AddDate(0, 0, -back).Format(dateLayoutTest)
}

const dateLayoutTest = "2006-01-02"

func figSetup(t *testing.T) figBook {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	now := time.Now()
	deletedAt := now.Add(-24 * time.Hour)

	years := 1
	if v, err := strconv.Atoi(os.Getenv("PERF_FIG_YEARS")); err == nil && v > 1 {
		years = v
	}

	suppliers := make([]m.Supplier, 0, figSuppliers)

	for i := range figSuppliers {
		s := m.Supplier{
			TeamID: figTeamBase + uint64(i%figTeams),
			Name: fmt.Sprintf("%s %s %s %d",
				perfPrefixes[perfPick(i, 1, len(perfPrefixes))],
				perfWords[perfPick(i, 2, len(perfWords))],
				perfWords[perfPick(i, 3, len(perfWords))],
				i),
			Contact:     fmt.Sprintf("08%010d", perfPick(i, 4, 1_000_000_000)),
			Address:     fmt.Sprintf("Jl. %s No. %d, %s", perfWords[perfPick(i, 5, len(perfWords))], i%200+1, perfCities[perfPick(i, 6, len(perfCities))]),
			Description: "seeded for the figures perf audit",
			CreatedAt:   now,
			UpdatedAt:   now,
		}

		if i%20 == 19 {
			s.DeletedAt = &deletedAt
		}

		suppliers = append(suppliers, s)
	}

	san_perf.SeedRows(t, db, &suppliers)

	stores := make([]m.SupplierChannel, 0, figSuppliers*figStoresPerSupplier)
	n := 0

	for _, s := range suppliers {
		for range figStoresPerSupplier {
			name := fmt.Sprintf("%s %s %s",
				perfWords[perfPick(n, 7, len(perfWords))],
				perfWords[perfPick(n, 8, len(perfWords))],
				perfSuffixes[perfPick(n, 9, len(perfSuffixes))])
			if n%997 == 0 {
				name = "Pusat Batik " + name
			}

			c := m.SupplierChannel{
				SupplierID:  s.ID,
				ChannelType: perfTypes[perfPick(n, 10, len(perfTypes))],
				Name:        name,
				URI:         fmt.Sprintf("https://store.example/%d", n),
				CreatedAt:   now,
				UpdatedAt:   now,
			}

			if n%20 == 7 {
				c.DeletedAt = &deletedAt
			}

			stores = append(stores, c)
			n++
		}
	}

	san_perf.SeedRows(t, db, &stores)

	// THE FIGURES, in one INSERT … SELECT. Product g belongs to team (g mod 8) and to ONE supplier, the supplier's rank
	// drawn as floor(u² · 2000) — a square skew, so a few suppliers carry many products. Each (product, day) is
	// restocked when its hash is 0 mod figEvery; the counts come off the same hash. Unique on the key by construction.
	// ⚠ INSERTED IN DAY ORDER, as the fold writes them — so a supplier's rows are scattered over the heap the way production
	// scatters them, not packed together (a per-supplier read would otherwise touch ~60× fewer pages than it will).
	firstDay := figDay(365*years - 1)
	start := time.Now()

	err := quiet.Exec(`
INSERT INTO supplier_product_daily_reports (
    day, supplier_id, product_id, team_id,
    restock_count, restock_valuation, shipping_lost_count, shipping_lost_valuation,
    shipping_broken_count, shipping_broken_valuation, last_updated)
SELECT d.day::date, s.id, p.product_id, p.team_id,
       x.rc, x.rc * p.price, x.lc, x.lc * p.price, x.bc, x.bc * p.price, NOW()
FROM (
    SELECT g,
           @productBase + g AS product_id,
           @teamBase + (g % @teams) AS team_id,
           1 + LEAST(@suppliers - 1,
                     floor(power(((hashint4(g) & 2147483647) % 1000003)::float8 / 1000003, 2) * @suppliers)::int) AS rn,
           1000 + ((hashint4(g * 31 + 7) & 2147483647) % 99000) AS price
    FROM generate_series(1, @products) g
) p
JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM suppliers WHERE id >= @firstSupplier) s ON s.rn = p.rn
CROSS JOIN generate_series(CAST(@firstDay AS date), CAST(@lastDay AS date), interval '1 day') d(day)
CROSS JOIN LATERAL (
    SELECT h,
           1 + (h / @every) % 40 AS rc,
           CASE WHEN (h / 1000) % 20 = 0 THEN 1 ELSE 0 END AS lc,
           CASE WHEN (h / 300) % 10 = 0 THEN 1 + (h / 30000) % 3 ELSE 0 END AS bc
    FROM (SELECT (hashint8(p.g::bigint * 100000 + (d.day::date - DATE '2000-01-01')) & 2147483647)::bigint AS h) hh
) x
WHERE x.h % @every = 0
ORDER BY d.day, x.h`,
		map[string]any{
			"productBase":   figProductBase,
			"teamBase":      figTeamBase,
			"teams":         figTeams,
			"suppliers":     figSuppliers,
			"products":      figProducts,
			"firstSupplier": suppliers[0].ID,
			"firstDay":      firstDay,
			"lastDay":       figLastDay,
			"every":         figEvery,
		},
	).Error
	if err != nil {
		t.Fatalf("seed figures: %v", err)
	}

	for _, table := range []string{"supplier_product_daily_reports", "suppliers", "supplier_channels"} {
		err = quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	b := figBook{perfBook: perfBook{db: db, probe: probe, team: figTeamBase}, years: years}

	err = quiet.Raw(`SELECT count(*) FROM supplier_product_daily_reports`).Scan(&b.rows).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	type perSupplier struct {
		SupplierID uint64
		N          int64
	}

	var ranked []perSupplier

	err = quiet.Raw(`SELECT supplier_id, count(*) AS n FROM supplier_product_daily_reports GROUP BY supplier_id ORDER BY n DESC, supplier_id`).
		Scan(&ranked).
		Error
	if err != nil {
		t.Fatalf("rank: %v", err)
	}

	b.top, b.topRows = ranked[0].SupplierID, ranked[0].N
	mid := ranked[len(ranked)/2]
	b.median, b.medianRows = mid.SupplierID, mid.N

	err = quiet.Raw(`SELECT DISTINCT product_id FROM supplier_product_daily_reports WHERE supplier_id = ? AND team_id = ? ORDER BY product_id LIMIT 20`,
		b.top, figTeamBase).
		Scan(&b.topProducts).
		Error
	if err != nil {
		t.Fatalf("top products: %v", err)
	}

	t.Logf("SEED years=%d suppliers=%d stores=%d products=%d report_rows=%d suppliers_with_rows=%d top=%d(%d rows) median=%d(%d rows) top_products_team0=%d seeded_in=%v",
		years, len(suppliers), len(stores), figProducts, b.rows, len(ranked), b.top, b.topRows, b.median, b.medianRows,
		len(b.topProducts), time.Since(start).Round(time.Millisecond))

	// PERF_PLAN_CACHE=custom|generic pins the server's plan cache for this transaction. The driver (pgx) PREPARES every
	// statement, so after five executions on one connection Postgres may switch a statement to its GENERIC plan — planned
	// once for any $1/$2, without the window's size. Unset is what production gets.
	if mode := os.Getenv("PERF_PLAN_CACHE"); mode != "" {
		err = quiet.Exec("SET LOCAL plan_cache_mode = force_" + mode + "_plan").Error
		if err != nil {
			t.Fatalf("plan_cache_mode: %v", err)
		}

		t.Logf("PLAN_CACHE force_%s_plan", mode)
	}

	b.svc = supplier_v1.NewService(db, perfSellingTeams{}, nil)

	return b
}

// figWant runs a case only when PERF_CASE is unset or a substring of its name — one case per process, so no case
// inherits a prepared statement another case already executed five times.
func figWant(name string) bool {
	want := os.Getenv("PERF_CASE")

	return want == "" || strings.Contains(name, want)
}

// figWindow is the last `days` seeded days, ending on figLastDay — plus any other filters.
func figWindow(days int, more ...*analytic_basev1.FilterItem) []*analytic_basev1.FilterItem {
	return append(filters(dateRange(figDay(days-1), figLastDay)), more...)
}

// figTeam narrows to the first seeded team's restocks, or nothing when 0.
func figTeam(team uint64) []*analytic_basev1.FilterItem {
	if team == 0 {
		return nil
	}

	return filters(restockTeam(team))
}

// What the two screens ask MetricSearch: the Supplier Report ranks suppliers by value or broken rate, over the default
// 30 days and a year, with and without a team, at two page sizes and deep into the pages; the Statistics
// tab's By Product ranks one supplier's products — the top supplier and the median one.
func TestPerf_MetricSearch(t *testing.T) {
	b := figSetup(t)

	type c struct {
		name    string
		group   analytic_basev1.GroupType
		field   string
		filters []*analytic_basev1.FilterItem
		offset  int32
		limit   int32
	}

	supplier, product := analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT

	cases := []c{
		{"suppliers/value/30d/limit=20", supplier, "restock_valuation", figWindow(30), 0, 20},
		{"suppliers/value/30d/limit=200", supplier, "restock_valuation", figWindow(30), 0, 200},
		{"suppliers/value/366d/limit=20", supplier, "restock_valuation", figWindow(366), 0, 20},
		{"suppliers/value/366d/limit=200", supplier, "restock_valuation", figWindow(366), 0, 200},
		{"suppliers/value/366d/offset=180/limit=20", supplier, "restock_valuation", figWindow(366), 180, 20},
		{"suppliers/value/366d/team/limit=20", supplier, "restock_valuation", figWindow(366, figTeam(figTeamBase)...), 0, 20},
		{"suppliers/broken/30d/limit=20", supplier, "broken_rate", figWindow(30), 0, 20},
		{"suppliers/broken/366d/limit=20", supplier, "broken_rate", figWindow(366), 0, 20},
		{fmt.Sprintf("suppliers/value/all-%dd/limit=20", 365*b.years), supplier, "restock_valuation", figWindow(365 * b.years), 0, 20},
		{"products/top/366d/limit=20", product, "restock_valuation", figWindow(366, oneSupplier(b.top)), 0, 20},
		{"products/top/366d/limit=200", product, "restock_valuation", figWindow(366, oneSupplier(b.top)), 0, 200},
		{"products/top/30d/limit=20", product, "restock_valuation", figWindow(30, oneSupplier(b.top)), 0, 20},
		{"products/top/366d/team/limit=20", product, "restock_valuation", figWindow(366, oneSupplier(b.top), restockTeam(figTeamBase)), 0, 20},
		{"products/median/366d/limit=20", product, "restock_valuation", figWindow(366, oneSupplier(b.median)), 0, 20},
	}

	for _, c := range cases {
		if !figWant(c.name) {
			continue
		}

		perfRun(t, b.perfBook, "MetricSearch/"+c.name, func(int) error {
			_, err := b.svc.MetricSearch(context.Background(), connect.NewRequest(&supplierv1.MetricSearchRequest{
				TeamId:  b.team,
				GroupBy: c.group,
				Filters: c.filters,
				Sort:    sortBy(c.field, analytic_basev1.SortType_SORT_TYPE_DESC),
				Page:    window(c.offset, c.limit),
			}))

			return err
		})
	}
}

// What the two screens ask MetricData: a ranked page's suppliers (the BIGGEST, so the most rows to sum) and products,
// the Statistics tab's periods — its 10 newest days, and the widest pages a request may carry — and every headline,
// grouped by SUMMARY.
func TestPerf_MetricData(t *testing.T) {
	b := figSetup(t)

	supplier, product := analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT
	daily, monthly := analytic_basev1.GroupType_GROUP_TYPE_DAILY, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY
	summary := analytic_basev1.GroupType_GROUP_TYPE_SUMMARY

	// The keys a search hands over — the screen's own first page.
	ranked := func(group analytic_basev1.GroupType, items []*analytic_basev1.FilterItem, limit int32) *analytic_basev1.MetricKeys {
		resp, err := b.svc.MetricSearch(context.Background(), connect.NewRequest(&supplierv1.MetricSearchRequest{
			TeamId: b.team, GroupBy: group, Filters: items,
			Sort: sortBy("restock_valuation", analytic_basev1.SortType_SORT_TYPE_DESC), Page: window(0, limit),
		}))
		if err != nil {
			t.Fatalf("ranking: %v", err)
		}

		return resp.Msg.GetKeys()
	}

	// The newest n days, or months, of the window — what the Statistics tab lists for itself.
	days := func(n int) *analytic_basev1.MetricKeys {
		out := make([]string, 0, n)
		for back := range n {
			out = append(out, figDay(back))
		}

		return dayKeys(out...)
	}

	months := func(n int) *analytic_basev1.MetricKeys {
		last, err := time.Parse(dateLayoutTest, figLastDay)
		if err != nil {
			t.Fatal(err)
		}

		first := time.Date(last.Year(), last.Month(), 1, 0, 0, 0, 0, time.UTC)
		out := make([]string, 0, n)

		for back := range n {
			out = append(out, first.AddDate(0, -back, 0).Format(dateLayoutTest))
		}

		return dayKeys(out...)
	}

	type c struct {
		name    string
		group   analytic_basev1.GroupType
		filters []*analytic_basev1.FilterItem
		keys    *analytic_basev1.MetricKeys
	}

	cases := []c{
		{"suppliers/30d/ids=20", supplier, figWindow(30), ranked(supplier, figWindow(30), 20)},
		{"suppliers/30d/ids=200", supplier, figWindow(30), ranked(supplier, figWindow(30), 200)},
		{"suppliers/366d/ids=20", supplier, figWindow(366), ranked(supplier, figWindow(366), 20)},
		{"suppliers/366d/ids=200", supplier, figWindow(366), ranked(supplier, figWindow(366), 200)},
		{"suppliers/366d/team/ids=200", supplier, figWindow(366, figTeam(figTeamBase)...),
			ranked(supplier, figWindow(366, figTeam(figTeamBase)...), 200)},
		{"products/top/366d/ids=20", product, figWindow(366, oneSupplier(b.top)), ranked(product, figWindow(366, oneSupplier(b.top)), 20)},
		{"products/top/366d/ids=200", product, figWindow(366, oneSupplier(b.top)), ranked(product, figWindow(366, oneSupplier(b.top)), 200)},
		{"days/top/30d/keys=10", daily, figWindow(30, oneSupplier(b.top)), days(10)},
		{"days/top/366d/keys=200", daily, figWindow(366, oneSupplier(b.top)), days(200)},
		{"days/median/366d/keys=10", daily, figWindow(366, oneSupplier(b.median)), days(10)},
		{"months/top/366d/keys=12", monthly, figWindow(366, oneSupplier(b.top)), months(12)},
		{"summary/30d", summary, figWindow(30), nil},
		{"summary/366d", summary, figWindow(366), nil},
		{fmt.Sprintf("summary/all-%dd", 365*b.years), summary, figWindow(365 * b.years), nil},
		{"summary/top/366d", summary, figWindow(366, oneSupplier(b.top)), nil},
	}

	for _, c := range cases {
		if !figWant(c.name) {
			continue
		}

		perfRun(t, b.perfBook, "MetricData/"+c.name, func(int) error {
			_, err := b.svc.MetricData(context.Background(), connect.NewRequest(&supplierv1.MetricDataRequest{
				TeamId:    b.team,
				GroupBy:   c.group,
				Filters:   c.filters,
				Keys:      c.keys,
				MetricIds: []string{suppliersMetric},
			}))

			return err
		})
	}
}

// One RestockAccepted of the top supplier, on the last seeded day (so some lines hit an existing row and some insert),
// at 5 and 20 lines — the statement count must be read against the line count. A fresh event id per call, or the
// dedup claim would fold nothing.
func TestPerf_AnalyticFold(t *testing.T) {
	b := figSetup(t)

	if len(b.topProducts) < 20 {
		t.Fatalf("the top supplier has %d products of team %d, need 20", len(b.topProducts), figTeamBase)
	}

	handler := b.svc.FoldHandler()
	restock := uint64(9_000_000)

	// 100 lines is a big supplier's full parcel — past the top supplier's 20 seeded products, so lines 21+ name products
	// the seed never bought (the warm-up INSERTs their rows, the measured runs UPDATE them, like every line before).
	for _, size := range []int{1, 5, 20, 100} {
		perfRun(t, b.perfBook, fmt.Sprintf("FoldHandler/lines=%d", size), func(int) error {
			restock++

			lines := make([]line, 0, size)
			for i := range size {
				product := figProductBase + 50_000 + uint64(i)
				if i < len(b.topProducts) {
					product = b.topProducts[i]
				}

				lines = append(lines, line{
					product: product, ordered: 24, total: 24 * 15_000,
					accepted: 22, broken: 1, lost: 1,
				})
			}

			return handler(context.Background(), accept(restock, figTeamBase, b.top, figLastDay, lines...))
		})
	}

	// The proposed shape, PROBED by hand on the same transaction — one statement for every line. Not the handler.

	values := ""
	for i := range 20 {
		if i > 0 {
			values += ", "
		}

		values += fmt.Sprintf("(%d, 22, 330000, 1, 15000, 1, 15000)", b.topProducts[i])
	}

	san_perf.Explain(t, b.db, fmt.Sprintf(`
INSERT INTO supplier_product_daily_reports AS d (
    day, supplier_id, product_id, team_id,
    restock_count, restock_valuation, shipping_lost_count, shipping_lost_valuation,
    shipping_broken_count, shipping_broken_valuation, last_updated)
SELECT CAST('%s' AS date), %d, v.product_id, %d, v.rc, v.rv, v.lc, v.lv, v.bc, v.bv, NOW()
FROM (VALUES %s) AS v(product_id, rc, rv, lc, lv, bc, bv)
ORDER BY v.product_id
ON CONFLICT (day, supplier_id, product_id, team_id) DO UPDATE
SET restock_count             = d.restock_count + EXCLUDED.restock_count,
    restock_valuation         = d.restock_valuation + EXCLUDED.restock_valuation,
    shipping_lost_count       = d.shipping_lost_count + EXCLUDED.shipping_lost_count,
    shipping_lost_valuation   = d.shipping_lost_valuation + EXCLUDED.shipping_lost_valuation,
    shipping_broken_count     = d.shipping_broken_count + EXCLUDED.shipping_broken_count,
    shipping_broken_valuation = d.shipping_broken_valuation + EXCLUDED.shipping_broken_valuation,
    last_updated              = NOW()`, figLastDay, b.top, figTeamBase, values))
}
