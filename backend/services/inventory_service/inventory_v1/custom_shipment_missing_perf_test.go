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
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// *BARANG TIDAK KETEMU* AT VOLUME (backlog #88 P6) — P2's list volume (custom_shipment_list_perf_test.go: P1's
// background, the busy pair's 40 000 parcels) with goods-missing notes on it: every second requested parcel noted
// (one in four twice), and one in fifty of the whole history noted before it moved on (picked, handed over, cancelled) —
// ~800 notes, each naming the parcel's two lines. The list now reads each requested row's open note
// (customShipmentOpenNotes); the reship choices and the create's cap count a cancelled reship's noted units
// (reshipItemGone). Run:
//
//	go test -tags perfaudit -p 1 -run "TestPerf_CustomShipmentGoodsMissing" -v ./backend/services/inventory_service/inventory_v1/

func perfGoodsMissingNotes(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO custom_shipment_logs (custom_shipment_id, kind, from_status, to_status, actor_user_id, description,
		                                   created_at)
		 SELECT c.id, 'goods_missing', 'requested', 'requested', 2, 'tidak ketemu di rak', c.created_at + INTERVAL '1 hour'
		 FROM custom_shipments c
		 WHERE c.note = 'perf-busy' AND ((c.status = 'requested' AND c.id % 2 = 0) OR c.id % 50 = 0)`,

		`INSERT INTO custom_shipment_logs (custom_shipment_id, kind, from_status, to_status, actor_user_id, description,
		                                   created_at)
		 SELECT c.id, 'goods_missing', 'requested', 'requested', 2, 'cek lagi', c.created_at + INTERVAL '2 hours'
		 FROM custom_shipments c
		 WHERE c.note = 'perf-busy' AND c.status = 'requested' AND c.id % 4 = 0`,

		`INSERT INTO custom_shipment_missing_lines (custom_shipment_log_id, custom_shipment_item_id, rack_id, quantity)
		 SELECT l.id, i.id, 0, 1
		 FROM custom_shipment_logs l JOIN custom_shipment_items i ON i.custom_shipment_id = l.custom_shipment_id
		 WHERE l.kind = 'goods_missing'`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("goods-missing notes: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"custom_shipment_logs", "custom_shipment_missing_lines"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

// perfGoodsMissingReshipNotes notes the units gone on every second CANCELLED reship of busy team 50
// (perfReshipBackground) — the rows reshipItemGone reads at every reship create and in the choices.
func perfGoodsMissingReshipNotes(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO custom_shipment_logs (custom_shipment_id, kind, from_status, to_status, actor_user_id, description)
		 SELECT c.id, 'goods_missing', 'requested', 'requested', 2, 'dibuang'
		 FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM custom_shipments
		       WHERE note = 'perf-busy-50' AND status = 'cancelled') c
		 WHERE c.n % 2 = 0`,

		`INSERT INTO custom_shipment_missing_lines (custom_shipment_log_id, custom_shipment_item_id, rack_id, quantity)
		 SELECT l.id, i.id, 0, i.quantity
		 FROM custom_shipment_logs l JOIN custom_shipment_items i ON i.custom_shipment_id = l.custom_shipment_id
		 JOIN custom_shipments c ON c.id = l.custom_shipment_id
		 WHERE l.kind = 'goods_missing' AND c.note = 'perf-busy-50'`,

		"ANALYZE custom_shipment_logs",
		"ANALYZE custom_shipment_missing_lines",
	}

	for _, statement := range statements {
		res := quiet.Exec(statement)
		if res.Error != nil {
			t.Fatalf("reship notes: %v\n%s", res.Error, statement)
		}

		t.Logf("reship notes: %d rows — %.60s", res.RowsAffected, strings.TrimSpace(statement))
	}
}

// THE LIST WITH THE BADGE — every P2 list case with the notes seeded (wall + queries: a page with a requested parcel
// reads its open notes, +1 statement, +2 when one has a note), then the open-notes statement on its own, as it ships
// (on 00057's trail key (custom_shipment_id, id)) and with a candidate partial index of the notes alone — custom and
// generic plans — and the detail and the note's write.
func TestPerf_CustomShipmentGoodsMissing(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)
	perfCustomShipmentBusyPair(t, db)
	perfGoodsMissingNotes(t, db)

	err := db.Exec("SELECT gin_clean_pending_list('custom_shipment_items_search_trgm_idx'::regclass)").Error
	if err != nil {
		t.Fatalf("clean the trigram pending list: %v", err)
	}

	var notes, open int64
	db.Raw(`SELECT COUNT(*) FROM custom_shipment_logs WHERE kind = 'goods_missing'`).Scan(&notes)
	db.Raw(`SELECT COUNT(DISTINCT l.custom_shipment_id) FROM custom_shipment_logs l JOIN custom_shipments c
	        ON c.id = l.custom_shipment_id WHERE l.kind = 'goods_missing' AND c.status = 'requested'`).Scan(&open)
	t.Logf("seeded %d goods-missing notes, %d requested parcels with one open", notes, open)

	cases := csListCases(t, db)
	csTimeAll(t, db, probe, "THE LIST WITH THE BADGE — custom plans", cases, map[string]bool{
		"warehouse 950 · requested (the queue) · p1": true,
	})

	logQueries(t, probe, cases, "warehouse 950 · requested (the queue) · p1")

	err = db.Exec("SET LOCAL plan_cache_mode = force_generic_plan").Error
	if err != nil {
		t.Fatalf("generic plans: %v", err)
	}

	csTimeAll(t, db, probe, "THE LIST WITH THE BADGE — generic plans", cases, nil)

	err = db.Exec("SET LOCAL plan_cache_mode = auto").Error
	if err != nil {
		t.Fatalf("auto plans: %v", err)
	}

	openNotesAB(t, db)

	// The detail of a noted parcel, and the note's own write.
	svc := perfCustomShipmentService(db)

	var noted struct {
		ID     uint64
		ItemID uint64
	}

	// The newest requested parcel of Gudang 950 noted twice (a seeded parcel has no take, so its line names no rack).
	db.Raw(`SELECT c.id, (SELECT MIN(i.id) FROM custom_shipment_items i WHERE i.custom_shipment_id = c.id) AS item_id
	        FROM custom_shipments c
	        WHERE c.note = 'perf-busy' AND c.status = 'requested' AND c.warehouse_id = 950
	          AND (SELECT COUNT(*) FROM custom_shipment_logs l WHERE l.custom_shipment_id = c.id AND l.kind = 'goods_missing') = 2
	        ORDER BY c.id DESC LIMIT 1`).Scan(&noted)

	if noted.ID == 0 {
		t.Fatal("no requested parcel noted twice in the seed")
	}

	other := []csPerfCase{
		{"detail of a noted parcel (2 notes) · warehouse", func() error {
			_, err := svc.CustomShipmentDetail(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentDetailRequest{
				TeamId: csPerfWarehouse, Id: noted.ID,
			}))

			return err
		}},
		{"MissingReport · one line, no rack", func() error {
			_, err := svc.CustomShipmentMissingReport(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentMissingReportRequest{
				TeamId: csPerfWarehouse, Id: noted.ID,
				Lines: []*inventoryv1.CustomShipmentMissingLine{{ItemId: noted.ItemID, Quantity: 1}},
			}))

			return err
		}},
	}

	csTimeAll(t, db, probe, "DETAIL AND WRITE", other, map[string]bool{"detail of a noted parcel (2 notes) · warehouse": true})
}

// logQueries logs the statements one call of the named case runs — the query count's breakdown.
func logQueries(t *testing.T, probe *san_perf.Probe, cases []csPerfCase, name string) {
	t.Helper()

	for _, c := range cases {
		if c.name != name {
			continue
		}

		probe.Reset()

		err := c.call()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		var b strings.Builder

		fmt.Fprintf(&b, "\nSTATEMENTS OF %q\n", name)

		for i, q := range probe.Queries() {
			sql := q.SQL
			if len(sql) > 160 {
				sql = sql[:160] + "…"
			}

			fmt.Fprintf(&b, "%d. %v  %s\n", i+1, q.Duration.Round(10*time.Microsecond), sql)
		}

		t.Log(b.String())
	}
}

// openNotesAB times the list's open-notes statement for a queue page (the warehouse's 20 newest requested parcels), on
// the trail's own (custom_shipment_id, id) key as it ships, then with a candidate partial index of the notes alone —
// the same seed, one process, old/new/new/old, custom and generic plans — and proves both read the same notes.
func openNotesAB(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	var ids []uint64
	quiet.Raw(`SELECT id FROM custom_shipments WHERE warehouse_id = 950 AND status = 'requested' ORDER BY id DESC LIMIT 20`).
		Scan(&ids)

	const statement = `SELECT DISTINCT ON (custom_shipment_id) * FROM custom_shipment_logs
	                   WHERE custom_shipment_id IN ? AND kind = 'goods_missing' ORDER BY custom_shipment_id, id DESC`

	timeIt := func() (time.Duration, int) {
		walls := make([]time.Duration, 0, 15)

		var n int

		for range 15 {
			var rows []struct{ ID uint64 }

			start := time.Now()

			err := quiet.Raw(statement, ids).Scan(&rows).Error
			if err != nil {
				t.Fatalf("open notes: %v", err)
			}

			walls = append(walls, time.Since(start))
			n = len(rows)
		}

		return san_perf.Median(walls), n
	}

	var b strings.Builder

	b.WriteString("\nOPEN NOTES OF A QUEUE PAGE — trail key vs + partial index (median of 15)\n" +
		"| plans | trail key | + partial | + partial again | trail key again | notes |\n|---|---|---|---|---|---|\n")

	for _, mode := range []string{"auto", "force_generic_plan"} {
		err := db.Exec("SET LOCAL plan_cache_mode = " + mode).Error
		if err != nil {
			t.Fatalf("plans %s: %v", mode, err)
		}

		old1, nOld := timeIt()

		for _, ddl := range []string{
			"CREATE INDEX custom_shipment_logs_goods_missing_idx ON custom_shipment_logs (custom_shipment_id, id DESC) " +
				"WHERE kind = 'goods_missing'",
			"ANALYZE custom_shipment_logs",
		} {
			err = db.Exec(ddl).Error
			if err != nil {
				t.Fatalf("%s: %v", ddl, err)
			}
		}

		new1, nNew := timeIt()
		new2, _ := timeIt()

		err = db.Exec("DROP INDEX custom_shipment_logs_goods_missing_idx").Error
		if err != nil {
			t.Fatalf("drop the candidate: %v", err)
		}

		old2, _ := timeIt()

		if nOld != nNew {
			t.Fatalf("%s: the trail key reads %d notes, the partial index %d", mode, nOld, nNew)
		}

		fmt.Fprintf(&b, "| %s | %v | %v | %v | %v | %d |\n", mode, old1.Round(time.Microsecond), new1.Round(time.Microsecond),
			new2.Round(time.Microsecond), old2.Round(time.Microsecond), nNew)
	}

	err := db.Exec("SET LOCAL plan_cache_mode = auto").Error
	if err != nil {
		t.Fatalf("auto plans: %v", err)
	}

	t.Log(b.String())

	idList := make([]string, 0, len(ids))
	for _, id := range ids {
		idList = append(idList, itoa(id))
	}

	san_perf.Explain(t, db, strings.Replace(statement, "?", "("+strings.Join(idList, ",")+")", 1))
}

// THE RESHIP CHOICES WITH NOTED UNITS — P2's options cases on busy team 50 with every second cancelled reship noted
// (its unit gone), then the options' count statement in P2's shape (the units on live reships only — kept verbatim) vs
// as it ships (reshipItemHeld: live, plus a cancelled one's noted units), one seed, old/new/new/old; the new counts
// fewer or as many restocks, never more.
func TestPerf_CustomShipmentGoodsMissingReshipOptions(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)
	perfReshipBackground(t, db)
	perfGoodsMissingReshipNotes(t, db)

	var noted int64
	db.Raw(`SELECT COUNT(*) FROM custom_shipment_missing_lines`).Scan(&noted)
	t.Logf("seeded %d noted lines on team 50's cancelled reships", noted)

	svc := perfCustomShipmentService(db)

	options := func(team uint64, q string, page uint32) func() error {
		return func() error {
			_, err := svc.CustomShipmentReshipOptions(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentReshipOptionsRequest{
				TeamId: team, Q: q, Page: &commonv1.CommonPagination{Page: page, Limit: 20},
			}))

			return err
		}
	}

	cases := []csPerfCase{
		{"team 50 (10 000 restocks, noted) · p1", options(50, "", 1)},
		{"team 50 · p30", options(50, "", 30)},
		{"team 50 · p past the end", options(50, "", 500)},
		{"team 50 · q sku-50 (every line)", options(50, "sku-50", 1)},
		{"team 2 (10 000, accept time unset) · p1", options(2, "", 1)},
		{"team 10 (2 000 restocks) · p1", options(10, "", 1)},
	}

	csTimeAll(t, db, probe, "RESHIP OPTIONS WITH NOTED UNITS — custom plans", cases,
		map[string]bool{"team 50 (10 000 restocks, noted) · p1": true})

	err := db.Exec("SET LOCAL plan_cache_mode = force_generic_plan").Error
	if err != nil {
		t.Fatalf("generic plans: %v", err)
	}

	csTimeAll(t, db, probe, "RESHIP OPTIONS WITH NOTED UNITS — generic plans", cases, nil)

	err = db.Exec("SET LOCAL plan_cache_mode = auto").Error
	if err != nil {
		t.Fatalf("auto plans: %v", err)
	}

	reshipHeldAB(t, db)
}

// reshipHeldAB times the options' count statement — P2's held units (live reships only, verbatim) vs P6's
// (reshipItemHeld, the shipped constant) — and checks the new never offers MORE restocks than the old.
func reshipHeldAB(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	const prefix = "SELECT count(*) FROM restocks AS r WHERE r.team_id = ? AND r.status = 'accepted' AND EXISTS (" +
		"SELECT 1 FROM restock_problem_items p " +
		"JOIN restock_items ri ON ri.restock_id = p.restock_id AND ri.product_id = p.product_id " +
		"WHERE p.restock_id = r.id AND p.problem_type = 'broken' AND "

	p2 := prefix + "p.count > COALESCE((" +
		"SELECT SUM(si.quantity) FROM custom_shipment_items si JOIN custom_shipments sc ON sc.id = si.custom_shipment_id " +
		"WHERE si.restock_item_id = ri.id AND sc.status <> 'cancelled'), 0) OFFSET 0)"
	p6 := prefix + inventory_v1.ReshipLineFree + " OFFSET 0)"

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

	b.WriteString("\nRESHIP OPTIONS' COUNT — P2 (live only) vs P6 (+ noted units) (median of 7, old/new/new/old)\n" +
		"| team | P2 | P6 | P6 again | P2 again | restocks P2 | restocks P6 |\n|---|---|---|---|---|---|---|\n")

	for _, team := range []uint64{50, 2, 10, 3} {
		old1, nOld := timeIt(p2, team)
		new1, nNew := timeIt(p6, team)
		new2, _ := timeIt(p6, team)
		old2, _ := timeIt(p2, team)

		if nNew > nOld {
			t.Fatalf("team %d: P6 offers %d restocks, P2 %d — noted units can only take restocks away", team, nNew, nOld)
		}

		fmt.Fprintf(&b, "| %d | %v | %v | %v | %v | %d | %d |\n", team, old1.Round(10*time.Microsecond),
			new1.Round(10*time.Microsecond), new2.Round(10*time.Microsecond), old2.Round(10*time.Microsecond), nOld, nNew)
	}

	t.Log(b.String())

	san_perf.Explain(t, db, strings.Replace(p6, "?", "50", 1))
}
