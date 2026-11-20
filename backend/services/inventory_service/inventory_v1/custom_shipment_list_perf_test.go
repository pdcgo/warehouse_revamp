//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE CUSTOM SHIPMENT LISTS AT VOLUME (backlog #88 P2). Beside P1's background (the ledger's 10 000 accepted restocks of
// team 2, 20 000 samples across 30 teams and 20 warehouses, a reship of every background restock), ONE BUSY PAIR: 40 000
// parcels over three years — selling team 900 owns 30 000 of them, Gudang 950 ships 35 000 (for 900 and nine other
// teams), team 900 also ships from 951. Nearly all are handed over; a twenty-fifth cancelled; the newest 100 still moving
// (50 requested, 50 picked) and ~40 old requested stragglers. One in ten is a reship. Two lines each.
const (
	csPerfTeam      uint64 = 900
	csPerfWarehouse uint64 = 950
)

func perfCustomShipmentBusyPair(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO custom_shipments (team_id, warehouse_id, kind, status, restock_id, recipient_name, recipient_phone,
		                               recipient_address, shipment_channel_id, payer, finance_account_id, shipping_cost,
		                               total, idempotency_key, note, created_at)
		 SELECT CASE WHEN g % 4 = 0 THEN 901 + g % 9 ELSE 900 END,
		        CASE WHEN g % 8 = 1 THEN 951 ELSE 950 END,
		        CASE WHEN g % 10 = 0 THEN 'restock_reship' ELSE 'sample' END,
		        CASE WHEN g > 39950 THEN 'requested'
		             WHEN g > 39900 THEN 'picked'
		             WHEN g % 997 = 0 THEN 'requested'
		             WHEN g % 25 = 0 THEN 'cancelled'
		             ELSE 'handed_over' END,
		        CASE WHEN g % 10 = 0 THEN 999999 ELSE 0 END,
		        CASE WHEN g % 1000 = 7 THEN 'Budi Santoso' ELSE 'Penerima ' || g END, '0812', 'Jl. Contoh ' || g,
		        9,
		        CASE WHEN g % 10 = 0 THEN 'warehouse' ELSE 'team' END,
		        CASE WHEN g % 10 = 0 THEN 0 ELSE 7 END,
		        10000,
		        CASE WHEN g % 10 = 0 THEN 0 ELSE 30000 END,
		        'busy-' || g, 'perf-busy', NOW() - (40000 - g) * INTERVAL '40 minutes'
		 FROM generate_series(1, 40000) g`,

		`INSERT INTO custom_shipment_items (custom_shipment_id, product_id, product_code, name, quantity, total)
		 SELECT c.id, 200000 + (c.id * 2 + k) % 500, 'SKU-' || (c.id * 2 + k) % 500, 'Produk ' || (c.id * 2 + k) % 500, 1,
		        CASE WHEN c.kind = 'sample' THEN 15000 ELSE 0 END
		 FROM custom_shipments c CROSS JOIN generate_series(0, 1) k WHERE c.note = 'perf-busy'`,

		`INSERT INTO custom_shipment_logs (custom_shipment_id, from_status, to_status, actor_user_id)
		 SELECT c.id, '', 'requested', 1 FROM custom_shipments c WHERE c.note = 'perf-busy'`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("busy pair: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"custom_shipments", "custom_shipment_items", "custom_shipment_logs"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

// perfReshipBackground gives the ledger background's 10 000 accepted restocks of team 2 (no accept time) broken units on
// one in ten: lines 1 and 2 broken 1–3 each — against P1's background reship of every restock (1 unit a line, a quarter
// of them cancelled), so some lines are fully sent and some still free; twenty other teams' 40 000; busy team 50's
// 10 000.
func perfReshipBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO restock_problem_items (restock_id, product_id, problem_type, count, note)
		 SELECT ri.restock_id, ri.product_id, 'broken', 1 + (ri.restock_id / 10) % 3, 'pecah'
		 FROM restock_items ri JOIN restocks r ON r.id = ri.restock_id
		 WHERE r.note = 'perf-bg' AND r.id % 10 = 0 AND ri.product_id IN (100001, 100002)`,

		// The rest of the platform: twenty more selling teams, 2 000 received restocks each over the same three years,
		// one in ten with two broken lines — so a team's options are judged among every team's problem rows.
		`INSERT INTO restocks (team_id, warehouse_id, status, finance_account_id, note, accepted_at)
		 SELECT 10 + g % 20, 1 + g % 20, 'accepted', 7, 'perf-other', NOW() - (40000 - g) * INTERVAL '40 minutes'
		 FROM generate_series(1, 40000) g`,

		`INSERT INTO restock_items (restock_id, product_id, product_code, name, count, total, price_unit, received_count)
		 SELECT r.id, 300000 + k, 'SKU-OT', 'other', 10, 10000, 1000, 10
		 FROM restocks r CROSS JOIN generate_series(1, 5) k WHERE r.note = 'perf-other'`,

		`INSERT INTO restock_problem_items (restock_id, product_id, problem_type, count, note)
		 SELECT ri.restock_id, ri.product_id, 'broken', 2, 'pecah'
		 FROM restock_items ri JOIN restocks r ON r.id = ri.restock_id
		 WHERE r.note = 'perf-other' AND r.id % 10 = 0 AND ri.product_id IN (300001, 300002)`,

		// THE BUSY TEAM 50: 10 000 received restocks over three years (accepted_at written at insert, as Terima does),
		// one in ten with two broken lines of 1–3 units; a third of those lines on a live reship of 1, a third on a
		// cancelled one.
		`INSERT INTO restocks (team_id, warehouse_id, status, finance_account_id, note, accepted_at)
		 SELECT 50, 1 + g % 20, 'accepted', 7, 'perf-busy-50', NOW() - (10000 - g) * INTERVAL '150 minutes'
		 FROM generate_series(1, 10000) g`,

		`INSERT INTO restock_items (restock_id, product_id, product_code, name, count, total, price_unit, received_count)
		 SELECT r.id, 400000 + k, 'SKU-50-' || k, 'Barang ' || k, 10, 10000, 1000, 10
		 FROM restocks r CROSS JOIN generate_series(1, 5) k WHERE r.note = 'perf-busy-50'`,

		`INSERT INTO restock_problem_items (restock_id, product_id, problem_type, count, note)
		 SELECT ri.restock_id, ri.product_id, 'broken', 1 + (ri.restock_id / 10) % 3, 'pecah'
		 FROM restock_items ri JOIN restocks r ON r.id = ri.restock_id
		 WHERE r.note = 'perf-busy-50' AND (r.id / 7) % 10 = 0 AND ri.product_id IN (400001, 400002)`,

		`INSERT INTO custom_shipments (team_id, warehouse_id, kind, status, restock_id, recipient_name, shipment_channel_id,
		                               payer, idempotency_key, note)
		 SELECT 50, r.warehouse_id, 'restock_reship', CASE WHEN p.id % 3 = 0 THEN 'requested' ELSE 'cancelled' END, r.id,
		        'supplier', 9, 'warehouse', 'busy50-' || p.id, 'perf-busy-50'
		 FROM restock_problem_items p JOIN restocks r ON r.id = p.restock_id
		 WHERE r.note = 'perf-busy-50' AND p.id % 3 <> 2`,

		`INSERT INTO custom_shipment_items (custom_shipment_id, product_id, product_code, name, quantity, restock_item_id)
		 SELECT c.id, ri.product_id, ri.product_code, ri.name, 1, ri.id
		 FROM custom_shipments c
		 JOIN restock_problem_items p ON c.idempotency_key = 'busy50-' || p.id
		 JOIN restock_items ri ON ri.restock_id = p.restock_id AND ri.product_id = p.product_id
		 WHERE c.note = 'perf-busy-50'`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("reship background: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"restocks", "restock_items", "restock_problem_items", "custom_shipments", "custom_shipment_items"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

// csPerfCase is one call to time.
type csPerfCase struct {
	name string
	call func() error
}

// csPerfTime runs a case once to warm, then 7 times, and answers its median wall and its queries per call. EXPLAIN
// (ANALYZE) of the slowest statement of the last run is logged when `explain` is set.
func csPerfTime(t *testing.T, db *gorm.DB, probe *san_perf.Probe, c csPerfCase, explain bool) (time.Duration, int) {
	t.Helper()

	err := c.call()
	if err != nil {
		t.Fatalf("%s: %v", c.name, err)
	}

	walls := make([]time.Duration, 0, 7)
	queries := 0

	for range 7 {
		probe.Reset()

		var callErr error

		wall, _ := probe.Measure(func() {
			callErr = c.call()
		})
		if callErr != nil {
			t.Fatalf("%s: %v", c.name, callErr)
		}

		walls = append(walls, wall)
		queries = probe.Count()
	}

	if explain {
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
	}

	return san_perf.Median(walls), queries
}

// csListCases is the list as each side opens it: the warehouse's queue (its requested tab, the screen it works from),
// its other tabs and filters, the selling team's, root's.
func csListCases(t *testing.T, db *gorm.DB) []csPerfCase {
	t.Helper()

	svc := perfCustomShipmentService(db)

	list := func(team uint64, filter *inventoryv1.CustomShipmentListFilter, page uint32) func() error {
		return func() error {
			_, err := svc.CustomShipmentList(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentListRequest{
				TeamId: team, Filter: filter, Page: &commonv1.CommonPagination{Page: page, Limit: 20},
			}))

			return err
		}
	}

	status := func(s inventoryv1.CustomShipmentStatus) *inventoryv1.CustomShipmentListFilter {
		return &inventoryv1.CustomShipmentListFilter{Status: s}
	}

	requested := inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED
	picked := inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_PICKED
	handed := inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_HANDED_OVER
	reship := inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP

	return []csPerfCase{
		{"warehouse 950 · all · p1", list(csPerfWarehouse, nil, 1)},
		{"warehouse 950 · requested (the queue) · p1", list(csPerfWarehouse, status(requested), 1)},
		{"warehouse 950 · picked · p1", list(csPerfWarehouse, status(picked), 1)},
		{"warehouse 950 · handed over · p50", list(csPerfWarehouse, status(handed), 50)},
		{"warehouse 950 · kind reship · p1", list(csPerfWarehouse, &inventoryv1.CustomShipmentListFilter{Kind: reship}, 1)},
		{"warehouse 950 · requested + reship · p1", list(csPerfWarehouse, &inventoryv1.CustomShipmentListFilter{Status: requested, Kind: reship}, 1)},
		{"warehouse 950 · q budi · p1", list(csPerfWarehouse, &inventoryv1.CustomShipmentListFilter{Q: "budi"}, 1)},
		{"warehouse 950 · q sku-42 · p1", list(csPerfWarehouse, &inventoryv1.CustomShipmentListFilter{Q: "sku-42"}, 1)},
		{"selling 900 · all · p1", list(csPerfTeam, nil, 1)},
		{"selling 900 · requested · p1", list(csPerfTeam, status(requested), 1)},
		{"selling 900 · all · p500", list(csPerfTeam, nil, 500)},
		{"selling 900 · warehouse 951 + requested · p1", list(csPerfTeam, &inventoryv1.CustomShipmentListFilter{Status: requested, WarehouseId: 951}, 1)},
		{"selling 2 (bg reships) · all · p1", list(2, nil, 1)},
		{"root · all · p1", list(san_auth.RootTeamID, nil, 1)},
		{"root · requested · p1", list(san_auth.RootTeamID, status(requested), 1)},
	}
}

// csTimeAll times every case and logs one table line each.
func csTimeAll(t *testing.T, db *gorm.DB, probe *san_perf.Probe, label string, cases []csPerfCase, explain map[string]bool) map[string]time.Duration {
	t.Helper()

	out := map[string]time.Duration{}

	var b strings.Builder

	fmt.Fprintf(&b, "\n%s\n| case | median wall | queries |\n|---|---|---|\n", label)

	for _, c := range cases {
		median, queries := csPerfTime(t, db, probe, c, explain[c.name])
		out[c.name] = median
		fmt.Fprintf(&b, "| %s | %v | %d |\n", c.name, median.Round(10*time.Microsecond), queries)
	}

	t.Log(b.String())

	return out
}

// THE LIST — without 00058's status indexes (P1's (team_id, id DESC), (warehouse_id, id DESC) alone: the two are
// dropped inside the test's transaction), then the same seed, the same process, with them put back — custom and generic
// plans. 00058 was added on this measurement (a-pure-index-is-added-without-asking).
func TestPerf_CustomShipmentList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)
	perfCustomShipmentBusyPair(t, db)

	// The seed's lines sit in the trigram index's GIN pending list inside this transaction (no autovacuum here) — fold
	// them in, as the live table's would be, before anything is timed.
	err := db.Exec("SELECT gin_clean_pending_list('custom_shipment_items_search_trgm_idx'::regclass)").Error
	if err != nil {
		t.Fatalf("clean the trigram pending list: %v", err)
	}

	for _, name := range []string{"custom_shipments_team_status_idx", "custom_shipments_warehouse_status_idx"} {
		err = db.Exec("DROP INDEX " + name).Error
		if err != nil {
			t.Fatalf("drop %s for the BEFORE pass: %v", name, err)
		}
	}

	cases := csListCases(t, db)
	explain := map[string]bool{
		"warehouse 950 · all · p1":                   true,
		"warehouse 950 · requested (the queue) · p1": true,
		"selling 900 · requested · p1":               true,
	}

	before := csTimeAll(t, db, probe, "BEFORE — without 00058 (P1's indexes alone)", cases, explain)

	err = db.Exec("SET LOCAL plan_cache_mode = force_generic_plan").Error
	if err != nil {
		t.Fatalf("generic plans: %v", err)
	}

	beforeGeneric := csTimeAll(t, db, probe, "BEFORE — generic plans", cases, nil)

	err = db.Exec("SET LOCAL plan_cache_mode = auto").Error
	if err != nil {
		t.Fatalf("auto plans: %v", err)
	}

	for _, ddl := range csListIndexCandidates {
		err = db.Exec(ddl).Error
		if err != nil {
			t.Fatalf("%s: %v", ddl, err)
		}
	}

	err = db.Exec("ANALYZE custom_shipments").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	after := csTimeAll(t, db, probe, "AFTER — with 00058's status indexes", cases, explain)

	err = db.Exec("SET LOCAL plan_cache_mode = force_generic_plan").Error
	if err != nil {
		t.Fatalf("generic plans: %v", err)
	}

	afterGeneric := csTimeAll(t, db, probe, "AFTER — generic plans", cases, nil)

	var b strings.Builder

	b.WriteString("\nBEFORE → AFTER (median wall, custom · generic)\n| case | before | after | before generic | after generic |\n|---|---|---|---|---|\n")

	for _, c := range cases {
		fmt.Fprintf(&b, "| %s | %v | %v | %v | %v |\n", c.name,
			before[c.name].Round(10*time.Microsecond), after[c.name].Round(10*time.Microsecond),
			beforeGeneric[c.name].Round(10*time.Microsecond), afterGeneric[c.name].Round(10*time.Microsecond))
	}

	t.Log(b.String())

}

// csListIndexCandidates is 00058, put back for the AFTER pass inside the test's transaction (rolled back with it).
var csListIndexCandidates = []string{
	"CREATE INDEX custom_shipments_team_status_idx ON custom_shipments (team_id, status, id DESC)",
	"CREATE INDEX custom_shipments_warehouse_status_idx ON custom_shipments (warehouse_id, status, id DESC)",
}

// THE RESHIP OPTIONS — busy team 50's 10 000 received restocks (1 000 with broken units, live and cancelled reships on
// them) and team 2's 10 000, among twenty other teams' 40 000; a team of 2 000 all with broken units; a team with none.
func TestPerf_CustomShipmentReshipOptions(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)
	perfReshipBackground(t, db)

	svc := perfCustomShipmentService(db)

	var someID uint64

	err := db.
		Raw("SELECT p.restock_id FROM restock_problem_items p JOIN restocks r ON r.id = p.restock_id " +
			"WHERE r.team_id = 50 AND p.count = 3 ORDER BY p.restock_id DESC LIMIT 1 OFFSET 30").
		Scan(&someID).
		Error
	if err != nil {
		t.Fatalf("a broken restock: %v", err)
	}

	options := func(team uint64, q string, page uint32) func() error {
		return func() error {
			_, err := svc.CustomShipmentReshipOptions(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentReshipOptionsRequest{
				TeamId: team, Q: q, Page: &commonv1.CommonPagination{Page: page, Limit: 20},
			}))

			return err
		}
	}

	cases := []csPerfCase{
		{"team 50 (10 000 restocks) · p1", options(50, "", 1)},
		{"team 50 · p30", options(50, "", 30)},
		{"team 50 · p past the end", options(50, "", 500)},
		{"team 50 · q #id", options(50, "#"+itoa(someID), 1)},
		{"team 50 · q sku-50 (every line)", options(50, "sku-50", 1)},
		{"team 50 · q zzz (no line)", options(50, "zzz", 1)},
		{"team 2 (10 000, accept time unset) · p1", options(2, "", 1)},
		{"team 3 (nothing) · p1", options(3, "", 1)},
		{"team 10 (2 000 restocks) · p1", options(10, "", 1)},
		{"team 10 · q zzz (no line)", options(10, "zzz", 1)},
	}

	csTimeAll(t, db, probe, "RESHIP OPTIONS — custom plans", cases, map[string]bool{"team 50 (10 000 restocks) · p1": true, "team 10 (2 000 restocks) · p1": true})

	err = db.Exec("SET LOCAL plan_cache_mode = force_generic_plan").Error
	if err != nil {
		t.Fatalf("generic plans: %v", err)
	}

	csTimeAll(t, db, probe, "RESHIP OPTIONS — generic plans", cases, nil)

	err = db.Exec("SET LOCAL plan_cache_mode = auto").Error
	if err != nil {
		t.Fatalf("auto plans: %v", err)
	}

	reshipScopeAB(t, db)
}

// reshipScopeAB times the options' count statement on one seed, in one process, as the planner flattens it (the EXISTS
// without OFFSET 0 — a semi-join over every team's broken rows) and as it ships (OFFSET 0 — a probe per restock of the
// team), old/new/new/old, and proves both count the same restocks.
func reshipScopeAB(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	shape := func(offset string) string {
		return "SELECT count(*) FROM restocks AS r WHERE r.team_id = ? AND r.status = 'accepted' AND EXISTS (" +
			"SELECT 1 FROM restock_problem_items p " +
			"JOIN restock_items ri ON ri.restock_id = p.restock_id AND ri.product_id = p.product_id " +
			"WHERE p.restock_id = r.id AND p.problem_type = 'broken' AND p.count > COALESCE((" +
			"SELECT SUM(si.quantity) FROM custom_shipment_items si JOIN custom_shipments sc ON sc.id = si.custom_shipment_id " +
			"WHERE si.restock_item_id = ri.id AND sc.status <> 'cancelled'), 0)" + offset + ")"
	}

	flattened, perRestock := shape(""), shape(" OFFSET 0")

	timeIt := func(sql string, team uint64) (time.Duration, int64) {
		walls := make([]time.Duration, 0, 7)

		var n int64

		for range 7 {
			start := time.Now()

			err := quiet.Raw(sql, team).Scan(&n).Error
			if err != nil {
				t.Fatalf("A/B count: %v", err)
			}

			walls = append(walls, time.Since(start))
		}

		return san_perf.Median(walls), n
	}

	var b strings.Builder

	b.WriteString("\nRESHIP OPTIONS' COUNT — flattened vs per restock (median of 7, old/new/new/old)\n" +
		"| team | flattened | per restock | flattened again | per restock again | restocks |\n|---|---|---|---|---|---|\n")

	for _, team := range []uint64{50, 2, 10, 3} {
		old1, nOld := timeIt(flattened, team)
		new1, nNew := timeIt(perRestock, team)
		new2, _ := timeIt(perRestock, team)
		old2, _ := timeIt(flattened, team)

		if nOld != nNew {
			t.Fatalf("team %d: the flattened shape counts %d, the per-restock one %d", team, nOld, nNew)
		}

		fmt.Fprintf(&b, "| %d | %v | %v | %v | %v | %d |\n", team, old1.Round(10*time.Microsecond), new1.Round(10*time.Microsecond),
			old2.Round(10*time.Microsecond), new2.Round(10*time.Microsecond), nNew)
	}

	t.Log(b.String())

	san_perf.Explain(t, db, strings.Replace(perRestock, "?", "10", 1))
}

// THE LIST'S FREE TEXT. A line is matched by `LOWER(code|name) LIKE '%q%'`, which Postgres runs once as a hashed subplan
// over the parcel lines, twice a call (count, page). Without 00058's trigram index (dropped inside the test's
// transaction) no b-tree serves the infix match and every team's lines are read; then the same seed, the same process,
// with it rebuilt — short terms included (a term with no run of three characters gives a trigram index nothing to look
// up, so the planner keeps the old plan).
func TestPerf_CustomShipmentListSearch(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)
	perfCustomShipmentBusyPair(t, db)

	err := db.Exec("DROP INDEX custom_shipment_items_search_trgm_idx").Error
	if err != nil {
		t.Fatalf("drop the trigram index for the BEFORE pass: %v", err)
	}

	svc := perfCustomShipmentService(db)

	list := func(team uint64, q string) func() error {
		return func() error {
			_, err := svc.CustomShipmentList(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentListRequest{
				TeamId: team, Filter: &inventoryv1.CustomShipmentListFilter{Q: q}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))

			return err
		}
	}

	cases := []csPerfCase{
		{"warehouse 950 · q budi (a recipient)", list(csPerfWarehouse, "budi")},
		{"warehouse 950 · q sku-42 (840 parcels)", list(csPerfWarehouse, "sku-42")},
		{"warehouse 950 · q produk 7 (many)", list(csPerfWarehouse, "produk 7")},
		{"warehouse 950 · q zzz (none)", list(csPerfWarehouse, "zzz")},
		{"warehouse 950 · q ab (two letters)", list(csPerfWarehouse, "ab")},
		{"warehouse 950 · q #39990 (a number)", list(csPerfWarehouse, "#39990")},
		{"selling 900 · q budi", list(csPerfTeam, "budi")},
		{"selling 2 · q budi (a small book)", list(2, "budi")},
	}

	before := csTimeAll(t, db, probe, "SEARCH — without 00058's trigram index", cases,
		map[string]bool{"warehouse 950 · q sku-42 (840 parcels)": true})

	// 00058's definition, rebuilt in bulk (no GIN pending list), then analyzed.
	for _, ddl := range []string{
		"CREATE INDEX custom_shipment_items_search_trgm_idx ON custom_shipment_items " +
			"USING gin (LOWER(product_code) gin_trgm_ops, LOWER(name) gin_trgm_ops)",
		"ANALYZE custom_shipment_items",
	} {
		err = db.Exec(ddl).Error
		if err != nil {
			t.Fatalf("%s: %v", ddl, err)
		}
	}

	after := csTimeAll(t, db, probe, "SEARCH — with 00058's trigram index", cases,
		map[string]bool{"warehouse 950 · q sku-42 (840 parcels)": true, "warehouse 950 · q ab (two letters)": true})

	var b strings.Builder

	b.WriteString("\nSEARCH BEFORE → WITH TRIGRAM (median wall)\n| case | before | with trigram |\n|---|---|---|\n")

	for _, c := range cases {
		fmt.Fprintf(&b, "| %s | %v | %v |\n", c.name, before[c.name].Round(10*time.Microsecond), after[c.name].Round(10*time.Microsecond))
	}

	t.Log(b.String())
}
