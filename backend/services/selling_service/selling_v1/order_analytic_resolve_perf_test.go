//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for Disputes resolved in the order metrics' day re-fold
// (the-order-status-moves-prototype-is-accepted, its 2026-11-20 line): the day read now asks, of every row into
// completed, whether its previous status row is problem (resolveSQL — a correlated lookup on `order_timeline_logs`), and
// a shop fix's lateral counts the resolves the same way. Both must stay index lookups as the timeline grows, and a day
// with no completed pays nothing for it (TestPerf_OrderShopFix_DayRefold, whose moves are returns).
//
//	go test -tags perfaudit -run TestPerf_OrderMovesResolve -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

const (
	perfResolveOrders = 20_000
	// One order in four goes shipped → completed with no dispute; the rest are a problem, a note, then resolved.
	perfCompleteEvery = 4
)

// seedResolveDay copies one placed order of team 2 into perfResolveOrders orders placed on one Jakarta day, each with
// its placement row, a move into shipped and — but every perfCompleteEvery-th — a problem and a note, then a move into
// completed: 20 000 completes, 15 000 of them resolves, 70 000 timeline rows on the day.
func seedResolveDay(t *testing.T, db *gorm.DB, template uint64, day time.Time) {
	t.Helper()

	var cols []string

	err := db.Raw(`SELECT column_name FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name NOT IN ('id', 'idempotency_key', 'created_at')
ORDER BY ordinal_position`).Scan(&cols).Error
	if err != nil {
		t.Fatalf("orders' columns: %v", err)
	}

	list := strings.Join(cols, ", ")
	row := func(status, note, after, where string) string {
		return `INSERT INTO order_timeline_logs (order_id, status, note, "from", actor_id, created_at)
SELECT id, '` + status + `', '` + note + `', 'selling', 7, created_at + interval '` + after + `'
FROM orders WHERE idempotency_key LIKE 'perf97-%'` + where
	}

	disputed := ` AND id % ` + itoa(perfCompleteEvery) + ` <> 0`

	for _, step := range []struct {
		name string
		sql  string
		args []any
	}{
		{"orders", `INSERT INTO orders (` + list + `, idempotency_key, created_at)
SELECT ` + list + `, 'perf97-' || g, CAST(? AS timestamptz) + g * interval '1 second'
FROM orders, generate_series(1, ?) g WHERE orders.id = ?`, []any{day, perfResolveOrders, template}},
		{"placement rows", row("pending", "", "0 seconds", ""), nil},
		{"shipped rows", row("shipped", "", "1 hour", ""), nil},
		{"problem rows", row("problem", "", "2 hours", disputed), nil},
		{"notes", row("", "buyer called", "3 hours", disputed), nil},
		{"completed rows", row("completed", "", "4 hours", ""), nil},
		{"analyze", `ANALYZE orders, order_timeline_logs`, nil},
	} {
		err = db.Exec(step.sql, step.args...).Error
		if err != nil {
			t.Fatalf("seed %s: %v", step.name, err)
		}
	}
}

func TestPerf_OrderMovesResolve_DayRefold(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Perf Resolve", "PF-RS", "shopee")
	template := placeOrder(t, svc, 2, shop)
	day := time.Date(2026, 10, 20, 1, 0, 0, 0, time.FixedZone("WIB", 7*60*60))

	seedResolveDay(t, db, template, day)

	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})

	var result selling_v1.OrderDayRefoldResult

	run := func() error {
		var err error

		result, err = analytic.DayRefold(context.Background(), selling_v1.OrderDayRefoldInput{TeamID: 2, Day: "2026-10-20", DryRun: true})

		return err
	}

	err := run() // warm-up
	if err != nil {
		t.Fatalf("DayRefold: %v", err)
	}

	resolved := int64(0)
	for _, row := range result.Rows {
		if row.Metric == "moves_disputes_resolved" && row.After != nil {
			resolved += row.After.OrderCount
		}
	}

	if want := int64(perfResolveOrders - perfResolveOrders/perfCompleteEvery); resolved != want {
		t.Fatalf("the re-fold rebuilt %d disputes resolved, want %d", resolved, want)
	}

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		probe.Reset()

		wall, _ := probe.Measure(func() { err = run() })
		if err != nil {
			t.Fatalf("DayRefold: %v", err)
		}

		walls = append(walls, wall)
	}

	t.Logf("DayRefold (dry run) over %d orders, %d completes, %d resolves: MEDIAN wall %v, queries %d",
		perfResolveOrders, perfResolveOrders, resolved, san_perf.Median(walls), probe.Count())

	probe.Report(t, "DayRefold (dry run)")

	// The day read, once: its plan must reach the previous status row through the timeline's order index.
	for _, q := range probe.Queries() {
		if !strings.Contains(q.SQL, "AS event_id, 'created' AS metric") {
			continue
		}

		plan := san_perf.Explain(t, db, q.SQL)
		t.Log(plan)

		if !strings.Contains(plan, "order_timeline_logs_order_idx") {
			t.Fatalf("the day read's resolve lookup is not an index lookup:\n%s", plan)
		}

		return
	}

	t.Fatalf("the day read was not seen")
}
