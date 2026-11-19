//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for a fix of an order's shop in the order metrics
// (an-orders-shop-is-fixed-and-counted-on-the-day): the re-fold's day read now asks, per move, which shop the order was
// in at that move (a correlated lookup on `order_shop_changes`), and reads the day's fixes with the moves each carries
// over (a lateral count on `order_timeline_logs`). Both must stay index lookups as the timeline grows.
//
//	go test -tags perfaudit -run TestPerf_OrderShopFix -v ./backend/services/selling_service/selling_v1/
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
	perfFixOrders = 20_000
	// One order in ten has had its shop fixed.
	perfFixEvery = 10
)

// seedShopFixDay copies one placed order of team 2 into perfFixOrders orders placed on one Jakarta day, each with its
// placement row and a move into `return`, and fixes every perfFixEvery-th one's shop (a note row and its change row).
func seedShopFixDay(t *testing.T, db *gorm.DB, template, from, to uint64, day time.Time) {
	t.Helper()

	var cols []string

	err := db.Raw(`SELECT column_name FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name NOT IN ('id', 'idempotency_key', 'created_at')
ORDER BY ordinal_position`).Scan(&cols).Error
	if err != nil {
		t.Fatalf("orders' columns: %v", err)
	}

	list := strings.Join(cols, ", ")

	for _, step := range []struct {
		name string
		sql  string
		args []any
	}{
		{"orders", `INSERT INTO orders (` + list + `, idempotency_key, created_at)
SELECT ` + list + `, 'perf86-' || g, CAST(? AS timestamptz) + g * interval '1 second'
FROM orders, generate_series(1, ?) g WHERE orders.id = ?`, []any{day, perfFixOrders, template}},
		{"placement rows", `INSERT INTO order_timeline_logs (order_id, status, note, "from", actor_id, created_at)
SELECT id, 'pending', '', 'selling', 7, created_at FROM orders WHERE idempotency_key LIKE 'perf86-%'`, nil},
		{"return rows", `INSERT INTO order_timeline_logs (order_id, status, note, "from", actor_id, created_at)
SELECT id, 'return', '', 'selling', 7, created_at + interval '1 hour'
FROM orders WHERE idempotency_key LIKE 'perf86-%'`, nil},
		{"fix notes", `INSERT INTO order_timeline_logs (order_id, status, note, "from", actor_id, created_at)
SELECT id, '', 'Toko: perf', 'selling', 7, created_at + interval '2 hours'
FROM orders WHERE idempotency_key LIKE 'perf86-%' AND id % ? = 0`, []any{perfFixEvery}},
		{"fixes", `INSERT INTO order_shop_changes (order_id, team_id, from_shop_id, to_shop_id, timeline_log_id, actor_id, created_at)
SELECT l.order_id, 2, ?, ?, l.id, 7, l.created_at FROM order_timeline_logs l JOIN orders o ON o.id = l.order_id
WHERE o.idempotency_key LIKE 'perf86-%' AND l.status = '' AND l.note = 'Toko: perf'`, []any{from, to}},
		{"fixed orders", `UPDATE orders SET shop_id = ? WHERE idempotency_key LIKE 'perf86-%' AND id % ? = 0`, []any{to, perfFixEvery}},
		{"analyze", `ANALYZE orders, order_timeline_logs, order_shop_changes`, nil},
	} {
		err = db.Exec(step.sql, step.args...).Error
		if err != nil {
			t.Fatalf("seed %s: %v", step.name, err)
		}
	}
}

func TestPerf_OrderShopFix_DayRefold(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	svc := newService(t, db)
	from := insertShop(t, db, 2, "Perf Wrong", "PF-W", "shopee")
	to := insertShop(t, db, 2, "Perf Right", "PF-R", "shopee")
	template := placeOrder(t, svc, 2, from)
	day := time.Date(2026, 10, 20, 1, 0, 0, 0, time.FixedZone("WIB", 7*60*60))

	seedShopFixDay(t, db, template, from, to, day)

	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	run := func() error {
		_, err := analytic.DayRefold(context.Background(), selling_v1.OrderDayRefoldInput{TeamID: 2, Day: "2026-10-20", DryRun: true})

		return err
	}

	err := run() // warm-up
	if err != nil {
		t.Fatalf("DayRefold: %v", err)
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

	t.Logf("DayRefold (dry run) over %d orders, %d moves, %d fixes: MEDIAN wall %v, queries %d",
		perfFixOrders, 2*perfFixOrders, perfFixOrders/perfFixEvery, san_perf.Median(walls), probe.Count())

	probe.Report(t, "DayRefold (dry run)")

	asOfIndexed, fixesIndexed := false, false
	asOfSeen, fixesSeen := false, false

	// Only the two reads asserted on, once each: the run also records its claims (an INSERT per lost event, which
	// EXPLAIN ANALYZE would execute) and the test transaction's own SAVEPOINT / RELEASE, which have no plan.
	for _, q := range probe.Queries() {
		asOf := strings.Contains(q.SQL, "c.timeline_log_id > m.log_id")
		fixes := strings.Contains(q.SQL, "'order-shop-changed:' || c.id AS event_id")

		if (!asOf || asOfSeen) && (!fixes || fixesSeen) {
			continue
		}

		plan := san_perf.Explain(t, db, q.SQL)

		if asOf {
			asOfSeen = true
			asOfIndexed = strings.Contains(plan, "order_shop_changes_order_idx")
		}

		if fixes {
			fixesSeen = true
			fixesIndexed = strings.Contains(plan, "order_timeline_logs_order_idx")
		}
	}

	if !asOfIndexed || !fixesIndexed {
		t.Fatalf("the as-of lookup indexed %v, the fixes' lateral count indexed %v — want both", asOfIndexed, fixesIndexed)
	}
}
