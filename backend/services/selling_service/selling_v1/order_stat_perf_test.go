//go:build perfaudit

package selling_v1_test

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// 50 000 orders — a transaction-grain table, and the one this stat scans in full: the census counts
// every order the team has ever placed, so this is the read whose cost grows forever if it grows at
// all. Spread across six statuses and 30 days so both halves of the response have work to do.
//
// ⚠ SHARED — TestPerf_OrderStatusChange and TestPerf_OrderCreatorList seed with this too, and lean on its
// explicit ids. TestPerf_OrderStat itself seeds perfStatOrderRows below.
func perfOrderRows(n int, shopIDs []uint64) []selling_service_models.Order {
	statuses := []string{"pending", "processed", "picked", "shipping", "shipped", "completed", "problem", "lost", "return", "return_completed", "cancel"}

	rows := make([]selling_service_models.Order, 0, n)

	for i := range n {
		rows = append(rows, selling_service_models.Order{
			ID:           uint64(1 + i),
			TeamID:       uint64(2 + i%5),
			ShopID:       shopIDs[i%len(shopIDs)],
			WarehouseID:  uint64(900 + i%3),
			Status:       statuses[i%len(statuses)],
			CustomerName: "Budi",
			Subtotal:     int64(10_000 + i),
			Total:        int64(15_000 + i),
			// Half inside the 30-day window, half outside it, so the FILTER aggregates are not
			// measured against a set that trivially matches everything.
			CreatedAt: time.Now().Add(-time.Duration(i%60) * 24 * time.Hour),
			UpdatedAt: time.Now(),
		})
	}

	return rows
}

// The stat's own seed. One team whose WHOLE HISTORY is 50 000 orders (the census reads every one of them, not a page),
// beside a smaller 10 000 spread over four other teams so the scope clause has rows to leave out and root has more to
// read than any one team.
const (
	perfStatTeam        uint64 = 2
	perfStatSmallTeam   uint64 = 3 // one of the four "other" teams: 2 500 orders — the second volume
	perfStatTeamOrders         = 50_000
	perfStatOtherOrders        = 10_000
)

var perfStatStatuses = []string{"pending", "processed", "picked", "shipping", "shipped", "completed", "problem", "lost", "return", "return_completed", "cancel"}

var perfStatNames = []string{"Budi", "Siti", "Agus", "Dewi", "Rina", "Joko"}

// perfStatOrderRows: ids are left to the sequence (SeedRows fills them back), so the lines can point at them.
//
// The margin's three inputs are set on independent residues, so "measurable" (all three) is ~40% of the rows and both
// FILTER sides do real work: a cost on 4 in 5 (i%5), a marketplace figure on 2 in 3 (i%3), a frozen fee on 3 in 4 (i%4).
// The tracking number (00018) is on 3 in 4, for the search's `receipt ILIKE`.
func perfStatOrderRows(n int, teamOf func(int) uint64, shopIDs []uint64, salt int) []selling_service_models.Order {
	now := time.Now()
	rows := make([]selling_service_models.Order, 0, n)

	for i := range n {
		k := salt + i
		total := int64(15_000 + k%5_000)

		o := selling_service_models.Order{
			TeamID:             teamOf(i),
			ShopID:             shopIDs[i%len(shopIDs)],
			WarehouseID:        uint64(900 + i%3),
			Status:             perfStatStatuses[i%len(perfStatStatuses)],
			CustomerName:       perfStatNames[i%len(perfStatNames)],
			CustomerPhone:      fmt.Sprintf("08%010d", k),
			OrderExternalRefID: fmt.Sprintf("INV-%08d", k),
			Subtotal:           total - 5_000,
			ShippingCost:       5_000,
			Total:              total,
			// Half inside the 30-day window, half outside it.
			CreatedAt: now.Add(-time.Duration(i%60) * 24 * time.Hour),
			UpdatedAt: now,
		}

		if i%5 != 0 {
			o.COGS = total / 2
		}

		if i%3 != 0 {
			o.MarketplaceTotal = total - 1_000
		}

		if i%4 != 0 {
			fee := float64(total) * 0.031
			o.WarehouseFee = &fee
		}

		if i%4 != 1 {
			o.Receipt = fmt.Sprintf("JX%010d", k)
		}

		rows = append(rows, o)
	}

	return rows
}

// Two or three lines per order (2.5 on average) — 150 000 order_items over the 60 000 orders.
func perfStatItemRows(orders []selling_service_models.Order) []selling_service_models.OrderItem {
	items := make([]selling_service_models.OrderItem, 0, len(orders)*5/2+1)

	for i, o := range orders {
		lines := 2 + i%2

		for j := range lines {
			items = append(items, selling_service_models.OrderItem{
				OrderID:   o.ID,
				ProductID: uint64(1_000 + (i+j)%500),
				SKU:       "SKU-" + strconv.Itoa((i+j)%500),
				Name:      "Barang " + strconv.Itoa((i+j)%500),
				Quantity:  uint32(1 + (i+j)%4),
				UnitPrice: 5_000,
				UnitCost:  2_500,
				CreatedAt: o.CreatedAt,
			})
		}
	}

	return items
}

type perfStatItems struct {
	Status    string
	ItemCount int64
}

// perfTimeSQL is the median of 5 warm runs of one raw statement on the test's own transaction — for the alternative
// SHAPES, which exist only as SQL in this file. Invisible to the probe.
func perfTimeSQL(t *testing.T, db *gorm.DB, sql string) (time.Duration, []perfStatItems) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	var out []perfStatItems

	err := quiet.Raw(sql).Scan(&out).Error // warm-up
	if err != nil {
		t.Fatalf("perfTimeSQL: %v\n%s", err, sql)
	}

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		out = nil
		start := time.Now()

		err = quiet.Raw(sql).Scan(&out).Error
		if err != nil {
			t.Fatalf("perfTimeSQL: %v", err)
		}

		walls = append(walls, time.Since(start))
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Status < out[j].Status })

	return san_perf.Median(walls), out
}

func TestPerf_OrderStat(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	// `orders.shop_id` is a real foreign key, so the shops have to exist before the orders can.
	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, perfStatTeam, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	orders := perfStatOrderRows(perfStatTeamOrders, func(int) uint64 { return perfStatTeam }, shopIDs, 0)
	orders = append(orders, perfStatOrderRows(perfStatOtherOrders, func(i int) uint64 { return uint64(3 + i%4) }, shopIDs, perfStatTeamOrders)...)

	san_perf.SeedRows(t, db, &orders)

	if orders[0].ID == 0 || orders[len(orders)-1].ID == 0 {
		t.Fatal("seed: the order ids were not filled back")
	}

	items := perfStatItemRows(orders)
	san_perf.SeedRows(t, db, &items)

	t.Logf("SEED orders=%d (team %d: %d, team %d: %d) order_items=%d",
		len(orders), perfStatTeam, perfStatTeamOrders, perfStatSmallTeam, perfStatOtherOrders/4, len(items))

	// The planner settings the verdict leans on — JIT's thresholds above all (see the report's JIT finding).
	var settings []string

	err := db.Session(&gorm.Session{Logger: logger.Discard}).
		Raw(`SELECT name || '=' || setting FROM pg_settings
		     WHERE name IN ('jit', 'jit_above_cost', 'jit_optimize_above_cost', 'jit_inline_above_cost',
		                    'max_parallel_workers_per_gather', 'work_mem')
		     UNION ALL SELECT version()`).
		Scan(&settings).
		Error
	if err != nil {
		t.Fatalf("settings: %v", err)
	}

	t.Logf("SETTINGS %s", strings.Join(settings, " · "))

	svc := newService(t, db)
	ctx := t.Context()

	cases := []struct {
		name string
		req  *sellingv1.OrderStatRequest
	}{
		// The second volume FIRST: a team twenty times smaller, while this connection's prepared statement has only
		// ever been planned for it (custom plans). One query either way — what moves is its time.
		{"team 2.5k, first on the conn", &sellingv1.OrderStatRequest{TeamId: perfStatSmallTeam}},
		// The header above the list as it first opens: the team's whole history, no filter.
		{"team 50k, no filter", &sellingv1.OrderStatRequest{TeamId: perfStatTeam}},
		// The SAME SQL text as the two above, so the SAME prepared statement — now after the big team has run it.
		{"team 2.5k, no filter", &sellingv1.OrderStatRequest{TeamId: perfStatSmallTeam}},
		// The new filter: the building the order ships from.
		{"team 50k, warehouse 900", &sellingv1.OrderStatRequest{
			TeamId: perfStatTeam, Filter: &sellingv1.OrderStatFilter{WarehouseId: 900},
		}},
		// The search, now over the tracking number too: a label scan's term.
		{"team 50k, search receipt", &sellingv1.OrderStatRequest{
			TeamId: perfStatTeam, Filter: &sellingv1.OrderStatFilter{Search: "JX00000123"},
		}},
		// Root reads every team (readsEveryTeam): no scope clause at all.
		{"root 60k, no filter", &sellingv1.OrderStatRequest{TeamId: san_auth.RootTeamID}},
	}

	asBuilt := map[string]string{} // case name → the handler's own interpolated SQL

	for _, c := range cases {
		// Warm-up: schema reflection and pool setup are not this RPC's cost.
		_, err := svc.OrderStat(ctx, connect.NewRequest(c.req))
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		walls := make([]time.Duration, 0, 5)
		dbs := make([]time.Duration, 0, 5)

		var queries int

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.OrderStat(ctx, connect.NewRequest(c.req))
			})
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			dbs = append(dbs, dbTime)
			queries = probe.Count()
		}

		wall := san_perf.Median(walls)
		dbm := san_perf.Median(dbs)

		sortedWalls := append([]time.Duration(nil), walls...)
		sort.Slice(sortedWalls, func(i, j int) bool { return sortedWalls[i] < sortedWalls[j] })

		t.Logf("CASE %-26s queries=%d median wall=%v db=%v go=%v max wall=%v",
			c.name, queries, wall, dbm, wall-dbm, sortedWalls[len(sortedWalls)-1])

		t.Logf("PLAN %s", c.name)
		san_perf.Explain(t, db, probe.Queries()[0].SQL)

		asBuilt[c.name] = probe.Queries()[0].SQL

		if c.name == "team 50k, no filter" {
			probe.Report(t, "OrderStat — "+c.name)
		}
	}

	scopes := []struct {
		caseName string
		where    string
	}{
		{"team 50k, no filter", fmt.Sprintf("(o.team_id = %d OR o.warehouse_id = %d)", perfStatTeam, perfStatTeam)},
		{"team 2.5k, no filter", fmt.Sprintf("(o.team_id = %d OR o.warehouse_id = %d)", perfStatSmallTeam, perfStatSmallTeam)},
		{"root 60k, no filter", "TRUE"},
	}

	for _, sc := range scopes {
		perfStatShapes(t, db, sc.caseName, asBuilt[sc.caseName], sc.where)
	}

	perfStatPlanCache(t, db, svc, asBuilt["team 2.5k, no filter"])

	// What the search's NEW leg (receipt ILIKE, 00018) adds: the same statement with and without it.
	search := asBuilt["team 50k, search receipt"]
	withoutReceipt := regexp.MustCompile(` OR receipt ILIKE '[^']*' ESCAPE '\\'`).ReplaceAllString(search, "")

	if withoutReceipt == search {
		t.Fatalf("search: the receipt leg was not found in\n%s", search)
	}

	withMedian, _ := perfTimeSQL(t, db, search)
	withoutMedian, _ := perfTimeSQL(t, db, withoutReceipt)

	t.Logf("SEARCH 4 ILIKE legs (with receipt) median=%v · 3 legs (without receipt) median=%v", withMedian, withoutMedian)
}

// perfStatPlanCache: pgx prepares the handler's statement once per connection and Postgres caches its plan, so every
// team shares the plan of ONE SQL text. This pins the small team's call to each plan_cache_mode through the handler
// itself, then shows the generic plan through a PREPARE of the same text.
func perfStatPlanCache(t *testing.T, db *gorm.DB, svc *selling_v1.Service, interpolated string) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	ctx := t.Context()
	req := &sellingv1.OrderStatRequest{TeamId: perfStatSmallTeam}

	for _, mode := range []string{"force_custom_plan", "force_generic_plan"} {
		err := quiet.Exec("SET LOCAL plan_cache_mode = " + mode).Error
		if err != nil {
			t.Fatalf("plan_cache_mode: %v", err)
		}

		_, err = svc.OrderStat(ctx, connect.NewRequest(req)) // warm under this mode
		if err != nil {
			t.Fatalf("OrderStat: %v", err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			start := time.Now()

			_, err = svc.OrderStat(ctx, connect.NewRequest(req))
			if err != nil {
				t.Fatalf("OrderStat: %v", err)
			}

			walls = append(walls, time.Since(start))
		}

		t.Logf("PLANCACHE handler team 2.5k %-20s median wall=%v", mode, san_perf.Median(walls))
	}

	// The same text with the scope and the window as PARAMETERS, as the handler sends it — for the generic plan's text.
	sql := regexp.MustCompile(`'\d{4}-\d{2}-\d{2} [0-9:.]+'`).ReplaceAllString(interpolated, "$$3")
	sql = strings.Replace(sql,
		fmt.Sprintf("team_id = %d OR warehouse_id = %d", perfStatSmallTeam, perfStatSmallTeam),
		"team_id = $1 OR warehouse_id = $2", 1)

	err := quiet.Exec("PREPARE perf_order_stat(bigint, bigint, timestamptz) AS " + sql).Error
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}

	execute := fmt.Sprintf("EXECUTE perf_order_stat(%d, %d, now() - interval '30 days')", perfStatSmallTeam, perfStatSmallTeam)

	for _, mode := range []string{"force_custom_plan", "force_generic_plan"} {
		err = quiet.Exec("SET LOCAL plan_cache_mode = " + mode).Error
		if err != nil {
			t.Fatalf("plan_cache_mode: %v", err)
		}

		t.Logf("PLAN PLANCACHE %s", mode)
		san_perf.Explain(t, db, execute)
	}

	err = quiet.Exec("SET LOCAL plan_cache_mode TO DEFAULT").Error
	if err != nil {
		t.Fatalf("plan_cache_mode: %v", err)
	}

	err = quiet.Exec("DEALLOCATE perf_order_stat").Error
	if err != nil {
		t.Fatalf("deallocate: %v", err)
	}
}

// perfStatShapes measures the alternative SHAPES for the units over one scope — measured, never applied (the report
// recommends; the handler is not touched). Each is checked to give the SAME per-status item_count as the handler, so a
// faster shape is not a faster wrong answer.
func perfStatShapes(t *testing.T, db *gorm.DB, caseName, asBuiltSQL, scope string) {
	t.Helper()

	measurable := "o.cogs > 0 AND o.marketplace_total > 0 AND o.warehouse_fee IS NOT NULL"

	// The head's columns minus the units — written over alias `o`.
	head := `o.status,
	        COUNT(*) AS count,
	        COALESCE(SUM(o.total), 0) AS value,
	        COALESCE(SUM(o.marketplace_total) FILTER (WHERE ` + measurable + `), 0) AS mp_value,
	        COALESCE(SUM(o.cogs) FILTER (WHERE ` + measurable + `), 0) AS cogs,
	        COALESCE(SUM(o.warehouse_fee) FILTER (WHERE ` + measurable + `), 0) AS fees,
	        COUNT(*) FILTER (WHERE NOT (` + measurable + `)) AS margin_unknown,
	        COUNT(*) FILTER (WHERE o.created_at >= now() - interval '30 days') AS count30_d,
	        COALESCE(SUM(o.total) FILTER (WHERE o.created_at >= now() - interval '30 days'), 0) AS value30_d`

	shapes := []struct {
		name  string
		sql   string
		units bool     // false = it does not compute the units, so there is nothing to compare
		set   []string // planner settings the shape runs under (SET LOCAL name = value), nil = the defaults
	}{
		{"A as built (correlated SubPlan per order)", asBuiltSQL, true, nil},
		// What the as-built costs once JIT's compile time is taken out.
		{"A' as built, jit = off", asBuiltSQL, true, []string{"jit = off"}},
		// The planner flips between two aggregate strategies for this statement from one ANALYZE to the next (the
		// SubPlan's cost swamps the difference between them), so each is pinned and measured on its own.
		{"A-hash as built, pinned to HashAggregate", asBuiltSQL, true, []string{"enable_sort = off"}},
		{"A-sort as built, pinned to Sort + GroupAggregate", asBuiltSQL, true, []string{"enable_hashagg = off"}},
		{"A-sort as built, pinned to Sort, work_mem = 64MB", asBuiltSQL, true, []string{"enable_hashagg = off", "work_mem = '64MB'"}},
		{"B without item_count (the cost floor)", `SELECT ` + head + ` FROM orders o WHERE ` + scope + ` GROUP BY o.status`, false, nil},
		{"C units JOINed and grouped by status, beside the head", `
WITH head AS (SELECT ` + head + ` FROM orders o WHERE ` + scope + ` GROUP BY o.status),
units AS (
  SELECT o.status, SUM(oi.quantity) AS item_count
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE ` + scope + `
  GROUP BY o.status
)
SELECT head.*, COALESCE(units.item_count, 0) AS item_count FROM head LEFT JOIN units USING (status)`, true, nil},
		{"D per-order pre-aggregate LEFT JOINed", `
SELECT ` + head + `, COALESCE(SUM(u.qty), 0) AS item_count
FROM orders o
LEFT JOIN (SELECT order_id, SUM(quantity) AS qty FROM order_items GROUP BY order_id) u ON u.order_id = o.id
WHERE ` + scope + `
GROUP BY o.status`, true, nil},
		// A denormalised orders.item_quantity cannot be added without a migration, so a column ALREADY on the row
		// stands in for it: SUM over one more int column of the same row is the work that design would do.
		{"E denormalised column (proxy: SUM of a column on the row)", `SELECT ` + head + `, COALESCE(SUM(o.shipping_cost), 0) AS item_count FROM orders o WHERE ` + scope + ` GROUP BY o.status`, false, nil},
	}

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	_, want := perfTimeSQL(t, db, asBuiltSQL)

	for _, s := range shapes {
		for _, set := range s.set {
			err := quiet.Exec("SET LOCAL " + set).Error
			if err != nil {
				t.Fatalf("set %s: %v", set, err)
			}
		}

		median, got := perfTimeSQL(t, db, s.sql)

		same := "n/a"
		if s.units {
			same = strconv.FormatBool(fmt.Sprint(got) == fmt.Sprint(want))
		}

		t.Logf("SHAPE [%s] %-58s median=%v same_units_as_built=%s", caseName, s.name, median, same)
		t.Logf("PLAN SHAPE [%s] %s", caseName, s.name)
		san_perf.Explain(t, db, strings.TrimSpace(s.sql))

		for _, set := range s.set {
			name := strings.TrimSpace(strings.SplitN(set, "=", 2)[0])

			err := quiet.Exec("SET LOCAL " + name + " TO DEFAULT").Error
			if err != nil {
				t.Fatalf("reset %s: %v", name, err)
			}
		}
	}
}
