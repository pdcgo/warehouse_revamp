//go:build raceaudit

// Concurrency audit for the order metrics' fold (the audit-sql skill) — a-report-is-fed-by-events-only-for-now.
//
// The fold is one transaction: the claim (INSERT … ON CONFLICT DO NOTHING on order_event_logs), one read of the order,
// one upsert into order_daily_reports. Two things could go wrong: two folds into ONE report row losing an increment,
// and two deliveries of ONE event both counting. Pub/Sub delivers at least once and in parallel, so both are normal.
//
//	go test -tags raceaudit -count=20 -run 'TestRace_OrderMetricFold' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// foldCount is the race team's report row for `metric` — its count, or -1 when there is none.
func foldCount(t *testing.T, h *san_race.Harness, metric string) int64 {
	t.Helper()

	var counts []int64

	err := h.DB().Raw(`SELECT order_count FROM order_daily_reports WHERE team_id = ? AND metric = ?`,
		raceOrderTeam, metric).Scan(&counts).Error
	if err != nil {
		t.Fatalf("report rows: %v", err)
	}

	if len(counts) != 1 {
		t.Fatalf("%d report rows for %s, want ONE — every order here shares day, shop, warehouse and creator", len(counts), metric)
	}

	return counts[0]
}

func cleanFold(t *testing.T, h *san_race.Harness) {
	t.Helper()

	clean := func() {
		// The dedup rows first: they are found through the race team's orders, which the harness deletes.
		err := h.DB().Exec(`DELETE FROM order_event_logs WHERE id IN (
		    SELECT 'order-placed:' || id FROM orders WHERE team_id = ?
		    UNION SELECT 'order-cancelled:' || id FROM orders WHERE team_id = ?)`, raceOrderTeam, raceOrderTeam).Error
		if err != nil {
			t.Errorf("cleaning the fold's dedup: %v", err)
		}

		err = h.DB().Exec(`DELETE FROM order_daily_reports WHERE team_id = ?`, raceOrderTeam).Error
		if err != nil {
			t.Errorf("cleaning the fold's report: %v", err)
		}
	}

	clean()
	t.Cleanup(clean)
}

// EIGHT ORDERS FOLD INTO ONE ROW AT ONCE, × 10 rounds: same day, shop, warehouse and creator, so every fold upserts
// the same report row. The row lock queues them — the count is exactly 8 per round, no increment lost.
func TestRace_OrderMetricFold_ManyOrdersIntoOneRow(t *testing.T) {
	h := orderRaceHarness(t)
	cleanFold(t, h)

	svc := newService(t, h.DB())
	analytic := selling_v1.NewAnalytic(h.DB(), fakeTeamTypes{})
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Fold", "RF-1", "shopee")

	const orders = 8

	for round := range 10 {
		ids := make([]uint64, orders)
		for i := range ids {
			ids[i] = raceOrder(t, svc, shopID)
		}

		res := h.Race(t, orders, func(i int) error {
			return analytic.FoldHandler()(context.Background(), placedEvent(ids[i], foldAt))
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d folds failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		if got := foldCount(t, h, "created"); got != int64(orders*(round+1)) {
			t.Fatalf("round %d: the row counts %d, want %d — an increment was lost", round, got, orders*(round+1))
		}
	}
}

// ONE EVENT DELIVERED SIX TIMES AT ONCE, × 20 rounds: the claim is the dedup — the second claim waits on the first's
// uncommitted row, then finds it and folds nothing. Each order counts exactly once.
func TestRace_OrderMetricFold_ARedeliveryCountsOnce(t *testing.T) {
	h := orderRaceHarness(t)
	cleanFold(t, h)

	svc := newService(t, h.DB())
	analytic := selling_v1.NewAnalytic(h.DB(), fakeTeamTypes{})
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Fold", "RF-2", "shopee")

	for round := range 20 {
		orderID := raceOrder(t, svc, shopID)

		res := h.Race(t, 6, func(int) error {
			return analytic.FoldHandler()(context.Background(), cancelledEvent(orderID, foldAt))
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d deliveries failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		if got := foldCount(t, h, "cancelled"); got != int64(round+1) {
			t.Fatalf("round %d: %d cancels counted, want %d — a redelivery counted twice", round, got, round+1)
		}
	}
}
