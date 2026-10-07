//go:build perfaudit

// The supplier's FIGURES — AnalyticTimeSearch, AnalyticProductSearch, AnalyticGroupSearch, AnalyticGroupMetric, and
// the fold that writes them (FoldHandler). One test per RPC; run them ONE AT A TIME (a rolled-back 500k-row seed
// leaves dead rows that bloat the next test's indexes):
//
//	go test -tags perfaudit -run TestPerf_AnalyticGroupSearch$ -v ./backend/services/supplier_service/supplier_v1/
//
// Volumes: `suppliers` 2 000 (8 selling teams, every 20th soft-deleted), `supplier_channels` 3 a supplier (6 000,
// every 20th soft-deleted), 10 000 products over the same 8 teams. Each product is bought from ONE supplier, drawn
// with a square skew (supplier #1 sells ~220 products, the median ~4), and restocked on ~1 day in 7 —
// `supplier_product_daily_reports` ≈ 520 000 rows over 365 days, inserted in day order as the fold writes them.
//
// Knobs: PERF_FIG_YEARS=n seeds n years at the same density (the growth check). PERF_PLAN_CACHE=custom|generic pins
// the server's plan cache. PERF_CASE=<substring> runs one case alone. PERF_REPORT=1 prints the per-statement table.
// TestPerf_AnalyticGroupSearch_Probe EXPLAINs the generic plans and the proposed rewrites — nothing is applied.
//
// Findings: audits/services/supplier_service/performances/{AnalyticGroupSearch,AnalyticGroupMetric,FoldHandler}.md.
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

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
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

func figRange(days int) *supplierv1.AnalyticDateRange {
	return &supplierv1.AnalyticDateRange{StartDate: figDay(days - 1), EndDate: figLastDay}
}

// Daily over 366 days (the daily cap) and 30 days (the screen's default), monthly over 60 months (the monthly cap),
// the top supplier and the median one, at two page sizes — the query count must not move with the page.
func TestPerf_AnalyticTimeSearch(t *testing.T) {
	b := figSetup(t)

	daily := supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY
	monthly := supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_MONTHLY
	sixtyMonths := &supplierv1.AnalyticDateRange{StartDate: "2021-11-01", EndDate: "2026-10-31"}

	cases := []struct {
		name     string
		supplier uint64
		tf       supplierv1.AnalyticTimeframe
		rng      *supplierv1.AnalyticDateRange
		team     uint64
		limit    uint32
	}{
		{"top/daily/366d/limit=20", b.top, daily, figRange(366), 0, 20},
		{"top/daily/366d/limit=200", b.top, daily, figRange(366), 0, 200},
		{"top/daily/30d/limit=20", b.top, daily, figRange(30), 0, 20},
		{"top/daily/366d/team/limit=20", b.top, daily, figRange(366), figTeamBase, 20},
		{"top/monthly/60mo/limit=60", b.top, monthly, sixtyMonths, 0, 60},
		{"median/daily/366d/limit=20", b.median, daily, figRange(366), 0, 20},
		{"median/monthly/60mo/limit=60", b.median, monthly, sixtyMonths, 0, 60},
	}

	for _, c := range cases {
		if !figWant(c.name) {
			continue
		}

		perfRun(t, b.perfBook, "AnalyticTimeSearch/"+c.name, func(int) error {
			_, err := b.svc.AnalyticTimeSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticTimeSearchRequest{
				TeamId:     b.team,
				SupplierId: c.supplier,
				Timeframe:  c.tf,
				Filter:     &supplierv1.AnalyticTimeSearchFilter{DateRange: c.rng, RestockTeamId: c.team},
				SortType:   commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
				Page:       perfPage(1, c.limit),
			}))

			return err
		})
	}
}

func TestPerf_AnalyticProductSearch(t *testing.T) {
	b := figSetup(t)

	cases := []struct {
		name     string
		supplier uint64
		days     int
		team     uint64
		page     uint32
		limit    uint32
	}{
		{"top/366d/limit=20", b.top, 366, 0, 1, 20},
		{"top/366d/limit=200", b.top, 366, 0, 1, 200},
		{"top/30d/limit=20", b.top, 30, 0, 1, 20},
		{"top/366d/team/limit=20", b.top, 366, figTeamBase, 1, 20},
		{"top/366d/page=10/limit=20", b.top, 366, 0, 10, 20},
		{"median/366d/limit=20", b.median, 366, 0, 1, 20},
	}

	for _, c := range cases {
		if !figWant(c.name) {
			continue
		}

		perfRun(t, b.perfBook, "AnalyticProductSearch/"+c.name, func(int) error {
			_, err := b.svc.AnalyticProductSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticProductSearchRequest{
				TeamId:     b.team,
				SupplierId: c.supplier,
				Filter:     &supplierv1.AnalyticTimeSearchFilter{DateRange: figRange(c.days), RestockTeamId: c.team},
				Page:       perfPage(c.page, c.limit),
			}))

			return err
		})
	}
}

// The Supplier Report's ranking: by value and by broken rate, with and without q, over the screen's default 30 days
// and a full year, at two page sizes.
func TestPerf_AnalyticGroupSearch(t *testing.T) {
	b := figSetup(t)

	value := supplierv1.AnalyticGroupSort_ANALYTIC_GROUP_SORT_RESTOCK_VALUATION
	broken := supplierv1.AnalyticGroupSort_ANALYTIC_GROUP_SORT_BROKEN_RATE

	cases := []struct {
		name  string
		sort  supplierv1.AnalyticGroupSort
		q     string
		days  int
		team  uint64
		page  uint32
		limit uint32
	}{
		{"value/30d/limit=20", value, "", 30, 0, 1, 20},
		{"value/30d/limit=200", value, "", 30, 0, 1, 200},
		{"value/366d/limit=20", value, "", 366, 0, 1, 20},
		{"value/366d/limit=200", value, "", 366, 0, 1, 200},
		{"value/366d/page=10/limit=20", value, "", 366, 0, 10, 20},
		{"value/366d/team/limit=20", value, "", 366, figTeamBase, 1, 20},
		{"broken/30d/limit=20", broken, "", 30, 0, 1, 20},
		{"broken/366d/limit=20", broken, "", 366, 0, 1, 20},
		{fmt.Sprintf("value/all-%dd/limit=20", 365*b.years), value, "", 365 * b.years, 0, 1, 20},
		{"value/30d/q=" + perfQ + "/limit=20", value, perfQ, 30, 0, 1, 20},
		{"value/366d/q=" + perfQ + "/limit=20", value, perfQ, 366, 0, 1, 20},
		{"broken/366d/q=" + perfQ + "/limit=20", broken, perfQ, 366, 0, 1, 20},
		{"value/366d/q=" + perfRareQ + "/limit=20", value, perfRareQ, 366, 0, 1, 20},
	}

	for _, c := range cases {
		if !figWant(c.name) {
			continue
		}

		perfRun(t, b.perfBook, "AnalyticGroupSearch/"+c.name, func(int) error {
			_, err := b.svc.AnalyticGroupSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticGroupSearchRequest{
				TeamId: b.team,
				Filter: &supplierv1.AnalyticGroupFilter{DateRange: figRange(c.days), RestockTeamId: c.team, Q: c.q},
				Sort:   c.sort,
				Page:   perfPage(c.page, c.limit),
			}))

			return err
		})
	}
}

// The ids are what the screen sends: the ranking's own page — the BIGGEST suppliers, so the most rows to sum.
func TestPerf_AnalyticGroupMetric(t *testing.T) {
	b := figSetup(t)

	cases := []struct {
		name  string
		days  int
		team  uint64
		limit uint32
	}{
		{"30d/ids=20", 30, 0, 20},
		{"30d/ids=200", 30, 0, 200},
		{"366d/ids=20", 366, 0, 20},
		{"366d/ids=200", 366, 0, 200},
		{"366d/team/ids=200", 366, figTeamBase, 200},
	}

	for _, c := range cases {
		if !figWant(c.name) {
			continue
		}

		filter := &supplierv1.AnalyticGroupFilter{DateRange: figRange(c.days), RestockTeamId: c.team}

		ranked, err := b.svc.AnalyticGroupSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticGroupSearchRequest{
			TeamId: b.team,
			Filter: filter,
			Sort:   supplierv1.AnalyticGroupSort_ANALYTIC_GROUP_SORT_RESTOCK_VALUATION,
			Page:   perfPage(1, c.limit),
		}))
		if err != nil {
			t.Fatalf("ranking for %s: %v", c.name, err)
		}

		ids := ranked.Msg.GetIds()

		perfRun(t, b.perfBook, fmt.Sprintf("AnalyticGroupMetric/%s(%d)", c.name, len(ids)), func(int) error {
			_, err := b.svc.AnalyticGroupMetric(context.Background(), connect.NewRequest(&supplierv1.AnalyticGroupMetricRequest{
				TeamId: b.team,
				Filter: filter,
				Ids:    ids,
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

// The ranking's two statements, PROBED outside the handler — nothing here is applied:
//
//   - the plan cache: each statement PREPARED with the window as $1/$2, as pgx sends it, then executed five times over
//     the screen's default 30 days and EXPLAINed over a year — what a pooled connection does after a day of use;
//   - the summary rewritten without COUNT(DISTINCT) (a grouped subquery, which can run in parallel);
//   - how many rows a (day, supplier, team) or (month, supplier, team) rollup would hold.
//
// go test -tags perfaudit -run TestPerf_AnalyticGroupSearch_Probe -v ./backend/services/supplier_service/supplier_v1/
func TestPerf_AnalyticGroupSearch_Probe(t *testing.T) {
	b := figSetup(t)
	db := b.db.Session(&gorm.Session{Logger: logger.Discard})

	year, month := figRange(366), figRange(30)
	sums := "COALESCE(SUM(r.restock_count), 0) AS restock_count, COALESCE(SUM(r.restock_valuation), 0) AS restock_valuation, " +
		"COALESCE(SUM(r.shipping_lost_count), 0) AS shipping_lost_count, COALESCE(SUM(r.shipping_lost_valuation), 0) AS shipping_lost_valuation, " +
		"COALESCE(SUM(r.shipping_broken_count), 0) AS shipping_broken_count, COALESCE(SUM(r.shipping_broken_valuation), 0) AS shipping_broken_valuation"
	where := "FROM supplier_product_daily_reports AS r WHERE r.day BETWEEN CAST($1 AS date) AND CAST($2 AS date)"

	statements := map[string]string{
		"fig_sum":  "SELECT COUNT(DISTINCT r.supplier_id) AS suppliers, " + sums + " " + where,
		"fig_page": "SELECT r.supplier_id " + where + " GROUP BY r.supplier_id ORDER BY SUM(r.restock_valuation) DESC, r.supplier_id LIMIT 20",
	}

	for name, sql := range statements {
		err := db.Exec("PREPARE " + name + "(date, date) AS " + sql).Error
		if err != nil {
			t.Fatalf("prepare %s: %v", name, err)
		}

		for range 5 {
			err = db.Exec(fmt.Sprintf("EXECUTE %s('%s', '%s')", name, month.StartDate, month.EndDate)).Error
			if err != nil {
				t.Fatalf("execute %s: %v", name, err)
			}
		}

		t.Logf("PROBE %s — auto mode, after five 30-day executions, now over a year:", name)
		san_perf.Explain(t, b.db, fmt.Sprintf("EXECUTE %s('%s', '%s')", name, year.StartDate, year.EndDate))
	}

	for _, w := range []*supplierv1.AnalyticDateRange{year, figRange(365 * b.years)} {
		t.Logf("PROBE the summary without COUNT(DISTINCT), %s..%s:", w.StartDate, w.EndDate)
		san_perf.Explain(t, b.db, fmt.Sprintf(`SELECT COUNT(*) AS suppliers, COALESCE(SUM(g.restock_count), 0), COALESCE(SUM(g.restock_valuation), 0),
       COALESCE(SUM(g.shipping_lost_count), 0), COALESCE(SUM(g.shipping_lost_valuation), 0),
       COALESCE(SUM(g.shipping_broken_count), 0), COALESCE(SUM(g.shipping_broken_valuation), 0)
FROM (SELECT r.supplier_id, %s FROM supplier_product_daily_reports AS r
      WHERE r.day BETWEEN DATE '%s' AND DATE '%s' GROUP BY r.supplier_id) g`, sums, w.StartDate, w.EndDate))
	}

	// AnalyticGroupMetric's statement, as GORM expands `IN ?` for the ranking's first 20 ids: $1/$2 the window, $3..$22
	// the ids. Five executions over 30 days, then a year — auto mode, as above.
	var top20 []uint64

	err := db.Raw(`SELECT supplier_id FROM supplier_product_daily_reports GROUP BY supplier_id ORDER BY SUM(restock_valuation) DESC LIMIT 20`).
		Scan(&top20).
		Error
	if err != nil {
		t.Fatalf("top 20: %v", err)
	}

	placeholders, types, values := make([]string, 0, 20), []string{"date", "date"}, make([]string, 0, 20)
	for i, id := range top20 {
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+3))
		types = append(types, "bigint")
		values = append(values, strconv.FormatUint(id, 10))
	}

	err = db.Exec("PREPARE fig_metric(" + strings.Join(types, ", ") + ") AS SELECT r.supplier_id, " + sums + " " + where +
		" AND r.supplier_id IN (" + strings.Join(placeholders, ",") + ") GROUP BY r.supplier_id").Error
	if err != nil {
		t.Fatalf("prepare fig_metric: %v", err)
	}

	for range 5 {
		err = db.Exec(fmt.Sprintf("EXECUTE fig_metric('%s', '%s', %s)", month.StartDate, month.EndDate, strings.Join(values, ", "))).Error
		if err != nil {
			t.Fatalf("execute fig_metric: %v", err)
		}
	}

	t.Logf("PROBE fig_metric — auto mode, after five 30-day executions, now over a year:")
	san_perf.Explain(t, b.db, fmt.Sprintf("EXECUTE fig_metric('%s', '%s', %s)", year.StartDate, year.EndDate, strings.Join(values, ", ")))

	t.Logf("PROBE the page and its totals in ONE statement, over a year:")
	san_perf.Explain(t, b.db, fmt.Sprintf(`WITH g AS (
    SELECT r.supplier_id, %s FROM supplier_product_daily_reports AS r
    WHERE r.day BETWEEN DATE '%s' AND DATE '%s' GROUP BY r.supplier_id)
SELECT g.supplier_id, COUNT(*) OVER () AS suppliers, SUM(g.restock_valuation) OVER () AS total_restock_valuation
FROM g ORDER BY g.restock_valuation DESC, g.supplier_id LIMIT 20`, sums, year.StartDate, year.EndDate))

	for _, grain := range []string{"day", "month"} {
		var n int64

		err := db.Raw(`SELECT count(*) FROM (SELECT DISTINCT date_trunc('` + grain + `', day), supplier_id, team_id FROM supplier_product_daily_reports) x`).
			Scan(&n).
			Error
		if err != nil {
			t.Fatalf("rollup size: %v", err)
		}

		t.Logf("PROBE a (%s, supplier, team) rollup holds %d rows, against %d daily product rows (%.1f×)", grain, n, b.rows, float64(b.rows)/float64(n))
	}
}
