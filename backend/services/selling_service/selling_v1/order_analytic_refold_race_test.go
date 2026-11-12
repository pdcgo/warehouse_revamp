//go:build raceaudit

// Concurrency audit for the ORDER METRICS' DAY RE-FOLD (a-wrong-day-is-refolded-from-the-log, for order_daily_reports
// — the audit-sql skill).
//
// WHY. The re-fold REPLACES report rows the fold INCREMENTS, and the fold keeps running while an operator repairs a
// day: an event in flight for that very day, a dead-lettered one redelivered at the same moment, a second operator
// running the same command. The fold takes no advisory lock — its claim, then its upsert's ROW EXCLUSIVE on the report —
// so the re-fold claims first and then takes the report in SHARE ROW EXCLUSIVE. Two bugs are possible and this file
// proves them absent:
//
//  1. A DOUBLE COUNT, or a LOST one: a move the re-fold counted folded again on top, or a move it left to the fold
//     overwritten by its replace.
//
//  2. A DEADLOCK between the re-folds' claims and table lock and the fold's claim and upsert (40P01).
//
//     go test -tags raceaudit -p 1 -run 'TestRace_OrderDayRefold' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"testing"
	"time"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// ⚠ THE BUG THIS PROVES IS ABSENT: per round, the day gains one folded placement, two LOST ones (placed two hours ago,
// never folded) and two IN FLIGHT (placed ten minutes ago). At once: two re-folds of the day, the folds of the two in
// flight, and a redelivery of each lost one. Whatever order they commit in, the day's row counts every order once, and
// nobody deadlocks. The re-folds sleep round%10 ms so both orderings are hit.
func TestRace_OrderDayRefold_AFoldRacingItCountsEveryOrderOnce(t *testing.T) {
	h := orderRaceHarness(t)
	cleanFold(t, h)

	db := h.DB()
	svc := newService(t, db)
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	shopID := insertShop(t, db, raceOrderTeam, "Race Refold", "RR-1", "shopee")
	ctx := context.Background()

	wibZone := time.FixedZone("WIB", 7*60*60)
	now := time.Now()
	today := now.In(wibZone).Format("2006-01-02")
	dayStart, _ := time.ParseInLocation("2006-01-02", today, wibZone)

	lostAt := now.Add(-2 * time.Hour)
	youngAt := now.Add(-10 * time.Minute)

	if lostAt.Before(dayStart) || youngAt.Before(dayStart) {
		t.Skip("within two hours of Jakarta midnight a lost order of today cannot be two hours old — run it later")
	}

	placed := func(at time.Time) uint64 {
		id := raceOrder(t, svc, shopID)

		err := db.Exec(`UPDATE orders SET created_at = ? WHERE id = ?`, at, id).Error
		if err != nil {
			t.Fatal(err)
		}

		return id
	}

	const rounds = 10

	countedYoung := 0

	for round := range rounds {
		folded := placed(lostAt)

		err := analytic.FoldHandler()(ctx, placedEvent(folded, lostAt))
		if err != nil {
			t.Fatal(err)
		}

		lost := []*eventsv1.Event{placedEvent(placed(lostAt), lostAt), placedEvent(placed(lostAt), lostAt)}
		young := []*eventsv1.Event{placedEvent(placed(youngAt), youngAt), placedEvent(placed(youngAt), youngAt)}

		results := make([]selling_v1.OrderDayRefoldResult, 2)

		res := h.Race(t, 6, func(i int) error {
			switch i {
			case 0, 1:
				time.Sleep(time.Duration(round%10) * time.Millisecond)

				var err error

				results[i], err = analytic.DayRefold(ctx, selling_v1.OrderDayRefoldInput{TeamID: raceOrderTeam, Day: today})

				return err
			case 2, 3:
				return analytic.FoldHandler()(ctx, young[i-2])
			default:
				return analytic.FoldHandler()(ctx, lost[i-4])
			}
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d of 6 callers failed — none should, a deadlock included", round, res.Failed())
		}

		for _, r := range results {
			if r.InFlight == 0 {
				countedYoung++
			}
		}

		if got, want := foldCount(t, h, "created"), int64(5*(round+1)); got != want {
			t.Fatalf("round %d: the day counts %d orders, want %d — every order once", round, got, want)
		}

		var claims int64

		err = db.Raw(`SELECT count(*) FROM order_event_logs WHERE id IN (SELECT 'order-placed:' || id FROM orders WHERE team_id = ?)`,
			raceOrderTeam).Scan(&claims).Error
		if err != nil {
			t.Fatal(err)
		}

		if claims != int64(5*(round+1)) {
			t.Fatalf("round %d: %d claims, want one per order", round, claims)
		}
	}

	t.Logf("of %d re-folds, %d found the in-flight orders already folded; the rest left them to the fold", 2*rounds, countedYoung)
}
