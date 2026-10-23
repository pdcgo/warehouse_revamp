//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the order-context RPCs of the 2026-10-21 pass:
// OrderStatusChange, OrderList as the root team reads it (every team, no team clause), and the return
// warehouse's Detail and Set.
//
//	go test -tags perfaudit -run 'TestPerf_OrderStatusChange|TestPerf_OrderList_Root|TestPerf_TeamReturnConfiguration' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// seedOrders seeds perfOrderRows' 50 000 orders over ten shops and returns them.
func seedOrders(t *testing.T, db *gorm.DB) []selling_service_models.Order {
	t.Helper()

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	rows := perfOrderRows(50_000, shopIDs)
	san_perf.SeedRows(t, db, rows)

	return rows
}

// THE BATCH MOVE at two batch sizes — a handover scan of 20 parcels and one of 200. Each order is its own
// transaction by design (one-status-change-for-every-plain-move), so the query count is EXPECTED to grow with
// the batch; what this measures is what that costs.
func TestPerf_OrderStatusChange(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	rows := seedOrders(t, db)

	// Processed orders shipping from warehouse 900 — the ones its crew may pick.
	var processed []uint64

	for _, r := range rows {
		if r.Status == "processed" && r.WarehouseID == 900 {
			processed = append(processed, r.ID)
		}
	}

	svc := newService(t, db)
	ctx := t.Context()

	take := func(n int) []uint64 {
		if len(processed) < n {
			t.Fatalf("only %d processed orders left, want %d", len(processed), n)
		}

		ids := processed[:n]
		processed = processed[n:]

		return ids
	}

	move := func(ids []uint64) {
		res, err := svc.OrderStatusChange(ctx, connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
			TeamId: 900, OrderIds: ids, To: sellingv1.OrderStatus_ORDER_STATUS_PICKED,
		}))
		if err != nil {
			t.Fatalf("OrderStatusChange: %v", err)
		}

		for _, r := range res.Msg.GetResults() {
			if !r.GetMoved() {
				t.Fatalf("order %d refused: %s", r.GetOrderId(), r.GetRefusedReason())
			}
		}
	}

	move(take(5)) // warm-up

	for _, batch := range []int{20, 200} {
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			ids := take(batch)

			probe.Reset()

			wall, dbTime := probe.Measure(func() { move(ids) })

			walls = append(walls, wall)
			t.Logf("batch=%d wall=%v db=%v go=%v queries=%d", batch, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("batch=%d MEDIAN wall %v", batch, san_perf.Median(walls))
		probe.Report(t, "OrderStatusChange batch "+strconv.Itoa(batch))
	}

	probe.Reset()
	move(take(1))

	// One order's statements. The SAVEPOINTs are san_testdb's outer transaction showing through — in production
	// they are BEGIN and COMMIT — and cannot be EXPLAINed.
	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
			continue
		}

		t.Log(san_perf.Explain(t, db, q.SQL))
	}
}

// perfTimelinePath is the run of statuses an order went through to reach `status`, pending first — the timeline rows
// OrderStatusChange would have written. Every order starts with the pending row OrderCreate writes.
func perfTimelinePath(status string) []string {
	forward := []string{"pending", "processed", "picked", "shipping", "shipped", "completed"}

	upTo := func(last string) []string {
		for i, s := range forward {
			if s == last {
				return append([]string(nil), forward[:i+1]...)
			}
		}

		return nil
	}

	switch status {
	case "problem", "lost":
		return append(upTo("shipping"), status)
	case "return":
		return append(upTo("shipped"), "return")
	case "return_completed":
		return append(upTo("shipped"), "return", "return_completed")
	case "cancel":
		return []string{"pending", "cancel"}
	default:
		return upTo(status)
	}
}

// perfTimelineRows builds each order's timeline: its path to its status, a SEND-BACK detour on every fourth order that
// reached processed (processed → pending → processed — on a processed order the status it is in now appears TWICE, and
// status_at has to take the newest), and a note-only row on every third. ~5 rows an order.
func perfTimelineRows(orders []selling_service_models.Order) []selling_service_models.OrderTimelineLog {
	rows := make([]selling_service_models.OrderTimelineLog, 0, 5*len(orders))

	for i, o := range orders {
		path := perfTimelinePath(o.Status)

		if i%4 == 0 && len(path) >= 2 && path[1] == "processed" {
			detour := []string{path[0], path[1], "pending", "processed"}
			path = append(detour, path[2:]...)
		}

		at := o.CreatedAt

		for _, s := range path {
			rows = append(rows, selling_service_models.OrderTimelineLog{
				OrderID: o.ID, Status: s, From: "warehouse", ActorID: 7, CreatedAt: at,
			})
			at = at.Add(3 * time.Hour)
		}

		if i%3 == 0 {
			rows = append(rows, selling_service_models.OrderTimelineLog{
				OrderID: o.ID, Note: "no goods on Rak A", From: "warehouse", ActorID: 7, CreatedAt: at,
			})
		}
	}

	return rows
}

// ROOT READS EVERY TEAM — no team clause, so this is the whole orders table: the count, and the page.
//
// Re-audit 2026-10-22: each row now also carries status_at, a correlated MAX over order_timeline_logs, and the search
// gained the tracking number. So the seed is 50 000 orders with 2–3 lines each (125 000 order_items) and ~5 timeline
// rows each (~250 000 order_timeline_logs), and every order has a phone, a marketplace ref and a tracking number for
// the ILIKE disjunction to read. Cases add the search, the warehouse filter, a team's own scope, the last page and the
// total sort — the last two are where a per-row subquery can run for rows the page never shows.
func TestPerf_OrderList_Root(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	// The text the search reads, distinct per order, set BEFORE the insert: an UPDATE after it would leave a dead
	// version of every row in the heap and its indexes, and every scan below would read twice the pages it should.
	orders := perfOrderRows(50_000, shopIDs)
	for i := range orders {
		id := orders[i].ID
		orders[i].CustomerName = fmt.Sprintf("Budi %d", id)
		orders[i].CustomerPhone = fmt.Sprintf("0812%08d", id)
		orders[i].OrderExternalRefID = fmt.Sprintf("2610%010d", id)
		orders[i].Receipt = fmt.Sprintf("JP%010d", id)
	}

	san_perf.SeedRows(t, db, orders)

	lines := make([]selling_service_models.OrderItem, 0, 3*len(orders))
	for i, o := range orders {
		for j := range 2 + i%2 {
			lines = append(lines, selling_service_models.OrderItem{
				OrderID: o.ID, ProductID: uint64(1 + j), SKU: "SKU", Name: "Widget", Quantity: uint32(1 + j),
				UnitPrice: 5_000, CreatedAt: time.Now(),
			})
		}
	}

	san_perf.SeedRows(t, db, lines)

	timeline := perfTimelineRows(orders)
	san_perf.SeedRows(t, db, timeline)

	t.Logf("seed: orders=%d order_items=%d order_timeline_logs=%d", len(orders), len(lines), len(timeline))

	svc := newService(t, db)
	ctx := t.Context()

	byTotal := &sellingv1.OrderListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
		S:        &sellingv1.OrderListFilterSort_Order{Order: sellingv1.OrderRowSort_ORDER_ROW_SORT_TOTAL},
	}

	type listCase = struct {
		name   string
		team   uint64
		filter *sellingv1.OrderListFilter
		sort   *sellingv1.OrderListFilterSort
		page   uint32
		limit  uint32
	}

	cases := []listCase{
		{"root · all, 20", san_auth.RootTeamID, &sellingv1.OrderListFilter{}, nil, 1, 20},
		{"root · all, 200", san_auth.RootTeamID, &sellingv1.OrderListFilter{}, nil, 1, 200},
		{"root · one status tab, 20", san_auth.RootTeamID, &sellingv1.OrderListFilter{Status: sellingv1.OrderStatus_ORDER_STATUS_PROCESSED}, nil, 1, 20},
		{"root · search tracking number, 20", san_auth.RootTeamID, &sellingv1.OrderListFilter{Search: "JP0000031337"}, nil, 1, 20},
		{"root · search digits, 20", san_auth.RootTeamID, &sellingv1.OrderListFilter{Search: "31337"}, nil, 1, 20},
		{"root · warehouse 900, 20", san_auth.RootTeamID, &sellingv1.OrderListFilter{WarehouseId: 900}, nil, 1, 20},
		{"root · warehouse 900, 200", san_auth.RootTeamID, &sellingv1.OrderListFilter{WarehouseId: 900}, nil, 1, 200},
		{"seller team 2 · warehouse 900, 20", 2, &sellingv1.OrderListFilter{WarehouseId: 900}, nil, 1, 20},
		{"warehouse 900 · own queue, 20", 900, &sellingv1.OrderListFilter{}, nil, 1, 20},
		{"warehouse 900 · search tracking number, 20", 900, &sellingv1.OrderListFilter{Search: "JP0000031339"}, nil, 1, 20},
		{"root · all, 200, LAST page", san_auth.RootTeamID, &sellingv1.OrderListFilter{}, nil, 250, 200},
		{"root · all, 20, sort by total", san_auth.RootTeamID, &sellingv1.OrderListFilter{}, byTotal, 1, 20},
	}

	statusAt := ", (SELECT MAX(tl.created_at) FROM order_timeline_logs tl WHERE tl.order_id = orders.id AND tl.status = orders.status) AS status_at"
	receiptLike := regexp.MustCompile(` OR receipt ILIKE '[^']*' ESCAPE '\\'`)

	// Explain on the test's transaction with JIT switched off, then back to the default — how much of a plan's time
	// is compiling it rather than running it.
	explainNoJIT := func(sql string) string {
		err := db.Exec("SET LOCAL jit = off").Error
		if err != nil {
			t.Fatalf("jit off: %v", err)
		}

		plan := san_perf.Explain(t, db, sql)

		err = db.Exec("RESET jit").Error
		if err != nil {
			t.Fatalf("jit reset: %v", err)
		}

		return plan
	}

	measure := func(c listCase) {
		req := &sellingv1.OrderListRequest{
			TeamId: c.team,
			Filter: c.filter,
			Sort:   c.sort,
			Page:   &commonv1.CommonPagination{Page: c.page, Limit: c.limit},
		}

		res, err := svc.OrderList(ctx, connect.NewRequest(req)) // warm-up
		if err != nil {
			t.Fatalf("OrderList warm-up: %v", err)
		}

		walls := make([]time.Duration, 0, 5)
		dbs := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				res, err = svc.OrderList(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("OrderList: %v", err)
			}

			walls = append(walls, wall)
			dbs = append(dbs, dbTime)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", c.name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v db %v · rows=%d total=%d queries=%d", c.name, san_perf.Median(walls),
			san_perf.Median(dbs), len(res.Msg.GetIds()), res.Msg.GetPageInfo().GetTotalItems(), probe.Count())
		probe.Report(t, "OrderList — "+c.name)

		for _, q := range probe.Queries() {
			plan := san_perf.Explain(t, db, q.SQL)

			if strings.Contains(plan, "JIT:") {
				t.Logf("JIT %s: on=%s off=%s", c.name, perfExecTime(plan), perfExecTime(explainNoJIT(q.SQL)))
			}

			// The search: the same SQL without the tracking number's ILIKE — what the new column added.
			if receiptLike.MatchString(q.SQL) {
				noReceipt := san_perf.Explain(t, db, receiptLike.ReplaceAllString(q.SQL, ""))
				t.Logf("RECEIPT %s: with=%s without=%s", c.name, perfExecTime(plan), perfExecTime(noReceipt))
			}

			// The page query: the same SQL without status_at, so the subquery's own share is a measured difference
			// rather than a reading of the plan's per-loop numbers.
			if !strings.Contains(q.SQL, statusAt) {
				continue
			}

			bare := san_perf.Explain(t, db, strings.Replace(q.SQL, statusAt, "", 1))
			t.Logf("STATUS_AT %s: with=%s without=%s", c.name, perfExecTime(plan), perfExecTime(bare))

			// A PROPOSED shape, measured and never applied: page the bare orders first, then look the two facts up for
			// the rows the page keeps. An OFFSET page otherwise runs both subqueries for every row it skips.
			if c.page > 1 {
				_, tail, ok := strings.Cut(q.SQL, " AS status_at ")
				if !ok {
					t.Fatalf("page SQL has no status_at: %s", q.SQL)
				}

				deferred := "SELECT p.*, " +
					"(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = p.id) AS item_quantity, " +
					"(SELECT MAX(tl.created_at) FROM order_timeline_logs tl WHERE tl.order_id = p.id AND tl.status = p.status) AS status_at " +
					"FROM (SELECT orders.* " + tail + ") p ORDER BY p.id DESC"

				t.Logf("DEFERRED %s: as built=%s deferred=%s", c.name, perfExecTime(plan),
					perfExecTime(san_perf.Explain(t, db, deferred)))
			}
		}
	}

	for _, c := range cases {
		measure(c)
	}

	// THE TRIGRAM PROBE — the proposed fix for the search, PROBED and not applied: pg_trgm and one multicolumn GIN
	// index over the four searched columns, created INSIDE this test's transaction (rolled back with it, never a
	// migration), then the UNCHANGED handler measured again.
	for _, ddl := range []string{
		"CREATE EXTENSION IF NOT EXISTS pg_trgm",
		"CREATE INDEX perf_orders_search_trgm ON orders USING gin " +
			"(customer_name gin_trgm_ops, customer_phone gin_trgm_ops, order_external_ref_id gin_trgm_ops, receipt gin_trgm_ops)",
		"ANALYZE orders",
	} {
		err := db.Exec(ddl).Error
		if err != nil {
			t.Fatalf("%s: %v", ddl, err)
		}
	}

	// The handler's statements are PREPARED and cached per connection (pgx's default), so after five runs Postgres may
	// switch a statement to its GENERIC plan — one planned without the pattern. A trigram index is only a fix if the
	// generic plan uses it too, so each search is measured pinned to each mode, and auto.
	setMode := func(mode string) {
		err := db.Exec("SET LOCAL plan_cache_mode = " + mode).Error
		if err != nil {
			t.Fatalf("plan_cache_mode %s: %v", mode, err)
		}
	}

	for _, mode := range []string{"auto", "force_custom_plan", "force_generic_plan"} {
		setMode(mode)

		for _, c := range cases {
			if c.filter.GetSearch() != "" {
				c.name = "TRGM " + mode + " " + c.name
				measure(c)
			}
		}
	}

	setMode("auto")

	// The generic plans themselves, for root's count and page of a text term.
	match := `(customer_name ILIKE $1 ESCAPE '\' OR customer_phone ILIKE $1 ESCAPE '\' ` +
		`OR order_external_ref_id ILIKE $1 ESCAPE '\' OR receipt ILIKE $1 ESCAPE '\')`

	for _, stmt := range []string{
		"SET LOCAL plan_cache_mode = force_generic_plan",
		`PREPARE perf_search(text) AS SELECT count(*) FROM "orders" WHERE ` + match,
		// orderListColumns, as the handler selects it (unexported, so written out here).
		`PREPARE perf_page(text) AS SELECT orders.*, ` +
			`(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = orders.id) AS item_quantity` +
			statusAt + ` FROM "orders" WHERE ` + match + ` ORDER BY id DESC LIMIT 20`,
	} {
		err := db.Exec(stmt).Error
		if err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}

	// A PROPOSED page shape, measured and never applied: find the matching ids FIRST, through the trigram index, so the
	// generic plan cannot choose to walk the primary key and test every order against the pattern.
	err := db.Exec(`PREPARE perf_page_m(text) AS WITH m AS MATERIALIZED (SELECT id FROM "orders" WHERE ` + match + `) ` +
		`SELECT orders.*, ` +
		`(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = orders.id) AS item_quantity` +
		statusAt + ` FROM "orders" WHERE id IN (SELECT id FROM m) ORDER BY id DESC LIMIT 20`).Error
	if err != nil {
		t.Fatalf("prepare perf_page_m: %v", err)
	}

	// A narrow term (one tracking number) and a broad one ("Budi 1" names ~11 000 orders).
	for _, term := range []string{"%JP0000031337%", "%Budi 1%"} {
		t.Logf("GENERIC TRGM %s: count=%s page as built=%s page ids-first=%s", term,
			perfExecTime(san_perf.Explain(t, db, "EXECUTE perf_search('"+term+"')")),
			perfExecTime(san_perf.Explain(t, db, "EXECUTE perf_page('"+term+"')")),
			perfExecTime(san_perf.Explain(t, db, "EXECUTE perf_page_m('"+term+"')")))
	}

	for _, stmt := range []string{"DEALLOCATE perf_search", "DEALLOCATE perf_page", "DEALLOCATE perf_page_m"} {
		err = db.Exec(stmt).Error
		if err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}

	setMode("auto")
}

// perfExecTime is the "Execution Time: …" figure of an EXPLAIN ANALYZE plan.
func perfExecTime(plan string) string {
	for _, line := range strings.Split(plan, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "Execution Time:") {
			return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "Execution Time:"))
		}
	}

	return "?"
}

// The return warehouse: one row by a unique key, read and upserted, over 10 000 teams' rows.
func TestPerf_TeamReturnConfiguration(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	rows := make([]selling_service_models.TeamReturnConfiguration, 0, 10_000)
	for i := range 10_000 {
		rows = append(rows, selling_service_models.TeamReturnConfiguration{
			TeamID: uint64(100_000 + i), WarehouseID: uint64(900 + i%3), CreatedAt: time.Now(), UpdatedAt: time.Now(),
		})
	}

	san_perf.SeedRows(t, db, rows)

	svc := newService(t, db)
	ctx := t.Context()

	detail := &sellingv1.TeamReturnConfigurationDetailRequest{TeamId: 105_000}
	set := &sellingv1.TeamReturnConfigurationSetRequest{TeamId: 105_000, WarehouseId: 41}

	// Root's Teams list asks for a page of teams at once: 200 ids, half of them with a row.
	teamIDs := make([]uint64, 0, 200)
	for i := range 200 {
		teamIDs = append(teamIDs, uint64(109_900+i))
	}

	byIds := &sellingv1.TeamReturnConfigurationByIdsRequest{Filter: &sellingv1.TeamReturnConfigurationByIdsFilter{Ids: teamIDs}}

	for _, rpc := range []struct {
		name string
		call func() error
	}{
		{"Detail", func() error {
			_, err := svc.TeamReturnConfigurationDetail(ctx, connect.NewRequest(detail))

			return err
		}},
		{"Set", func() error {
			_, err := svc.TeamReturnConfigurationSet(ctx, connect.NewRequest(set))

			return err
		}},
		{"ByIds 200", func() error {
			_, err := svc.TeamReturnConfigurationByIds(ctx, connect.NewRequest(byIds))

			return err
		}},
	} {
		err := rpc.call() // warm-up
		if err != nil {
			t.Fatalf("%s warm-up: %v", rpc.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = rpc.call() })
			if err != nil {
				t.Fatalf("%s: %v", rpc.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v queries=%d", rpc.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", rpc.name, san_perf.Median(walls))
		probe.Report(t, "TeamReturnConfiguration"+rpc.name)

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}

// THE EXPORT — a warehouse exporting everything shipping from it: ~16 700 of the 50 000 orders, two lines each, in
// 200-row steps. The query count grows with the rows BY DESIGN (two per step: the page and its shops), so what is
// measured is the time per step and whether either query degrades as the keyset walks down the table.
func TestPerf_OrderExport(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	orders := seedOrders(t, db)

	lines := make([]selling_service_models.OrderItem, 0, 2*len(orders))
	for _, o := range orders {
		for j := range 2 {
			lines = append(lines, selling_service_models.OrderItem{
				OrderID: o.ID, ProductID: uint64(1 + j), SKU: "SKU", Name: "Widget", Quantity: uint32(1 + j),
				UnitPrice: 5_000, CreatedAt: time.Now(),
			})
		}
	}

	san_perf.SeedRows(t, db, lines)

	store := &fakeExports{}
	req := &sellingv1.OrderExportRequest{
		TeamId: 900, Filter: &sellingv1.OrderListFilter{}, View: sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE,
	}

	export(t, db, store, req) // warm-up

	probe.Reset()

	var run exportRun

	wall, dbTime := probe.Measure(func() { run = export(t, db, store, req) })

	t.Logf("rows=%d wall=%v db=%v go=%v queries=%d file=%d bytes messages=%d",
		len(run.rows)-1, wall, dbTime, wall-dbTime, probe.Count(), len(store.content), len(run.messages))
	probe.Report(t, "OrderExport — warehouse 900, every order")

	for _, q := range probe.Queries() {
		if strings.Contains(q.SQL, "item_quantity") {
			t.Log(san_perf.Explain(t, db, q.SQL))

			break
		}
	}
}
