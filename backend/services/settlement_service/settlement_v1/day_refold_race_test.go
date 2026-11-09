//go:build raceaudit

// Concurrency audit for the DAY RE-FOLD (a-wrong-day-is-refolded-from-the-log, a-refold-shifts-the-later-days,
// the-person-report-refolds-too — the audit-sql skill).
//
// WHY. The re-fold replaces a report row the fold increments, shifts the later days the fold also shifts, and the fold
// keeps running while an operator repairs a day: an event in flight for that very day, a late event for the day
// before, a dead-lettered one redelivered at the same moment, a second operator running the same command, the other
// report's re-fold. Three bugs are possible and this file proves them absent:
//
//  1. A DOUBLE COUNT. A row the re-fold counted is folded again on top — or a row it left to the fold is lost — in
//     either report.
//
//  2. A BROKEN CARRY. A later day's open/close shifted twice, or not at all, so it no longer equals the running sum.
//
//  3. A DEADLOCK between the re-folds' claims and advisory locks and the fold's (40P01).
//
//     go test -tags raceaudit -p 1 -run 'TestRace_Refold' -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// refoldTables is the fold's tables, the log, and the order accounts the person re-fold reads its creator from.
var refoldTables = append([]string{"settlement_logs", "order_settlements"}, foldTables...)

// ⚠ THE BUG THIS PROVES IS ABSENT: per round, a day holding one folded row, two LOST rows (written hours ago, never
// folded) and two rows IN FLIGHT (written now). At once: two re-folds of the day, the folds of the two in-flight rows,
// and a redelivery of each lost row. Whatever order they commit in, the day ends equal to its log — every row once —
// and nobody deadlocks. The re-folds sleep round%10 ms so both orderings are hit.
func TestRace_Refold_AFoldRacingItCountsEveryRowOnce(t *testing.T) {
	h := san_race.New(t, refoldTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)
	ctx := context.Background()

	const rounds = 10

	countedYoung := 0

	for round := 0; round < rounds; round++ {
		day := fmt.Sprintf("2026-03-%02d", round+1)

		folded := refoldLogRow(t, db, day, settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -sale, 48*time.Hour)
		fold(t, svc, folded)

		lost := []*eventsv1.Event{
			refoldLogRow(t, db, day, settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 30_000, 3*time.Hour),
			refoldLogRow(t, db, day, settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -2_000, 3*time.Hour),
		}
		young := []*eventsv1.Event{
			refoldLogRow(t, db, day, settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 50_000, 0),
			refoldLogRow(t, db, day, settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE, -7_000, 0),
		}

		results := make([]settlement_v1.DayRefoldResult, 2)

		res := h.Race(t, 6, func(i int) error {
			switch i {
			case 0, 1:
				time.Sleep(time.Duration(round%10) * time.Millisecond)

				var err error

				results[i], err = svc.DayRefold(ctx, settlement_v1.DayRefoldInput{
					Report: settlement_v1.ReportShopDaily, ShopID: shop, Day: day,
				})

				return err
			case 2, 3:
				return svc.FoldHandler()(ctx, young[i-2])
			default:
				return svc.FoldHandler()(ctx, lost[i-4])
			}
		})

		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d of 6 callers failed — none should, a deadlock included", round, res.Failed())
		}

		for _, r := range results {
			if r.InFlight == 0 {
				countedYoung++
			}
		}

		rows := []settlement_service_models.ShopSettlementDailyReport{}

		err := db.Where("shop_id = ? AND team_id = ? AND day = CAST(? AS date)", shop, team, day).Find(&rows).Error
		if err != nil {
			t.Fatal(err)
		}

		want := -sale + 30_000 - 2_000 + 50_000 - 7_000
		if len(rows) != 1 || rows[0].Change != want || rows[0].Fund != 80_000 || rows[0].Other != -2_000 ||
			rows[0].ExternalAdsFee != -7_000 || rows[0].InitialTotal != -sale {
			t.Fatalf("round %v: the day = %+v, want every log row once (change %v)", round, rows, want)
		}

		var claims int64

		err = db.Raw(`SELECT COUNT(*) FROM settlement_event_logs WHERE day = CAST(? AS date)`, day).Scan(&claims).Error
		if err != nil {
			t.Fatal(err)
		}

		if claims != 5 {
			t.Fatalf("round %d: %d claims, want one per log row", round, claims)
		}
	}

	t.Logf("of %d re-folds, %d found the in-flight rows already folded; the rest left them to the fold", 2*rounds, countedYoung)
}

// assertCarryChains: the scope's rows, day by day, each equal to its own log's sum, opening where the one before
// closed, the first at 0 — and the state row the newest close. A shift applied twice, or missed, breaks it.
func assertCarryChains(t *testing.T, db *gorm.DB, round int, table, keyColumn, stateTable string, key uint64, logScope string) {
	t.Helper()

	rows := []struct {
		Day time.Time
		settlement_service_models.SettlementMetricColumns
		Logged float64
	}{}

	err := db.Raw(fmt.Sprintf(`
SELECT r.*,
       (SELECT COALESCE(SUM(l.change), 0) FROM settlement_logs l
        LEFT JOIN order_settlements o ON o.order_id = l.order_id
        WHERE %[3]s AND l.posted_on = r.day) AS logged
FROM %[1]s r
WHERE r.%[2]s = ? AND r.team_id = ?
ORDER BY r.day`, table, keyColumn, logScope), key, team).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatal(err)
	}

	var carried float64

	for _, row := range rows {
		if row.Change != row.Logged || row.OpenBalance != carried || row.CloseBalance != row.OpenBalance+row.Change {
			t.Fatalf("round %v: %s %v on %s = change %v (log %v), open %v (carried %v), close %v — the carry broke",
				round, table, key, row.Day.Format(time.DateOnly), row.Change, row.Logged, row.OpenBalance, carried, row.CloseBalance)
		}

		carried = row.CloseBalance
	}

	var state float64

	err = db.Raw(fmt.Sprintf(`SELECT close_balance FROM %s WHERE %s = ? AND team_id = ?`, stateTable, keyColumn), key, team).
		Scan(&state).
		Error
	if err != nil {
		t.Fatal(err)
	}

	if state != carried {
		t.Fatalf("round %v: %s %v state close %v, want the newest close %v", round, stateTable, key, state, carried)
	}
}

// ⚠ THE BUG THIS PROVES IS ABSENT: per round, a fresh shop with three days folded, the middle one holding two LOST rows
// and two rows IN FLIGHT. At once: two re-folds of the middle day (each shifting the third day by whatever it adds),
// the folds of the two in-flight rows (each shifting the third day too), the redeliveries of the lost rows, a LATE event
// on the first day (shifting the middle and the third) and a new event on the third. Whatever order they commit in, every
// day equals its log and every open is the close before it — no shift doubled, none lost — and nobody deadlocks.
func TestRace_Refold_TheLaterDaysTakeEveryShiftOnce(t *testing.T) {
	h := san_race.New(t, refoldTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)
	ctx := context.Background()

	const rounds = 10

	base := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)

	for round := 0; round < rounds; round++ {
		shopID := uint64(700 + round)
		orderID := uint64(70_000 + round)

		days := []string{
			base.AddDate(0, 0, 3*round).Format(time.DateOnly),
			base.AddDate(0, 0, 3*round+1).Format(time.DateOnly),
			base.AddDate(0, 0, 3*round+2).Format(time.DateOnly),
		}

		row := func(day string, settlementType settlementv1.SettlementType, change float64, age time.Duration) *eventsv1.Event {
			return refoldLogRowAt(t, db, shopID, orderID, day, settlementType, change, age)
		}

		fold(t, svc,
			row(days[0], settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -sale, 48*time.Hour),
			row(days[1], settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 10_000, 48*time.Hour),
			row(days[2], settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 20_000, 48*time.Hour),
		)

		events := []*eventsv1.Event{
			row(days[1], settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 50_000, 0),
			row(days[1], settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE, -7_000, 0),
			row(days[1], settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 30_000, 3*time.Hour),
			row(days[1], settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -2_000, 3*time.Hour),
			row(days[0], settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -1_000, 0),
			row(days[2], settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 4_000, 0),
		}

		res := h.Race(t, 8, func(i int) error {
			switch i {
			case 0, 1:
				time.Sleep(time.Duration(round%10) * time.Millisecond)

				_, err := svc.DayRefold(ctx, settlement_v1.DayRefoldInput{
					Report: settlement_v1.ReportShopDaily, ShopID: shopID, Day: days[1],
				})

				return err
			default:
				return svc.FoldHandler()(ctx, events[i-2])
			}
		})

		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d of 8 callers failed — none should, a deadlock included", round, res.Failed())
		}

		assertCarryChains(t, db, round, "shop_settlement_daily_reports", "shop_id", "shop_settlement_reports", shopID,
			fmt.Sprintf("l.shop_id = %d", shopID))

		var claims int64

		err := db.Raw(`SELECT COUNT(*) FROM settlement_event_logs e JOIN settlement_logs l ON e.id = 'settlement-log:' || l.id
			WHERE l.shop_id = ?`, shopID).Scan(&claims).Error
		if err != nil {
			t.Fatal(err)
		}

		if claims != 9 {
			t.Fatalf("round %d: %d claims, want one per log row (9)", round, claims)
		}
	}
}

// ⚠ THE BUG THIS PROVES IS ABSENT: per round, a day holding one folded row, two LOST rows and two rows IN FLIGHT, on a
// fresh shop, all counted for one person. At once: the SHOP re-fold and the PERSON re-fold of that day (one claims each
// lost row, the other counts the claim), the folds of the in-flight rows and the redeliveries of the lost ones. Whatever
// order they commit in, the shop's day and the person's day each hold every row once, the person's carry chains across
// every round's day, and nobody deadlocks.
func TestRace_Refold_TheShopAndPersonRefoldsCountEveryRowOnce(t *testing.T) {
	h := san_race.New(t, refoldTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)
	ctx := context.Background()

	const rounds = 10

	base := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)

	claimedBy := map[string]int{}

	for round := 0; round < rounds; round++ {
		shopID := uint64(800 + round)
		orderID := uint64(80_000 + round)
		day := base.AddDate(0, 0, round).Format(time.DateOnly)

		row := func(settlementType settlementv1.SettlementType, change float64, age time.Duration) *eventsv1.Event {
			return refoldLogRowAt(t, db, shopID, orderID, day, settlementType, change, age)
		}

		fold(t, svc, row(settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -sale, 48*time.Hour))

		events := []*eventsv1.Event{
			row(settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 50_000, 0),
			row(settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE, -7_000, 0),
			row(settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 30_000, 3*time.Hour),
			row(settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -2_000, 3*time.Hour),
		}

		user := creator
		results := make([]settlement_v1.DayRefoldResult, 2)

		res := h.Race(t, 6, func(i int) error {
			var err error

			switch i {
			case 0:
				results[0], err = svc.DayRefold(ctx, settlement_v1.DayRefoldInput{
					Report: settlement_v1.ReportShopDaily, ShopID: shopID, Day: day,
				})
			case 1:
				time.Sleep(time.Duration(round%10) * time.Millisecond)

				results[1], err = svc.DayRefold(ctx, settlement_v1.DayRefoldInput{
					Report: settlement_v1.ReportUserDaily, UserID: &user, Day: day,
				})
			default:
				err = svc.FoldHandler()(ctx, events[i-2])
			}

			return err
		})

		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d of 6 callers failed — none should, a deadlock included", round, res.Failed())
		}

		claimedBy["shop"] += results[0].Claimed
		claimedBy["person"] += results[1].Claimed

		want := -sale + 50_000 - 7_000 + 30_000 - 2_000

		var shopDay, personDay []settlement_service_models.SettlementMetricColumns

		err := db.Raw(`SELECT * FROM shop_settlement_daily_reports WHERE shop_id = ? AND team_id = ? AND day = CAST(? AS date)`,
			shopID, team, day).Scan(&shopDay).Error
		if err != nil {
			t.Fatal(err)
		}

		err = db.Raw(`SELECT * FROM user_settlement_daily_reports WHERE user_id = ? AND team_id = ? AND day = CAST(? AS date)`,
			creator, team, day).Scan(&personDay).Error
		if err != nil {
			t.Fatal(err)
		}

		if len(shopDay) != 1 || shopDay[0].Change != want || shopDay[0].Fund != 80_000 {
			t.Fatalf("round %v: the shop's day = %+v, want every log row once (change %v)", round, shopDay, want)
		}

		if len(personDay) != 1 || personDay[0].Change != want || personDay[0].Fund != 80_000 || personDay[0].Other != -2_000 {
			t.Fatalf("round %v: the person's day = %+v, want every log row once (change %v)", round, personDay, want)
		}

		assertCarryChains(t, db, round, "shop_settlement_daily_reports", "shop_id", "shop_settlement_reports", shopID,
			fmt.Sprintf("l.shop_id = %d", shopID))
		assertCarryChains(t, db, round, "user_settlement_daily_reports", "user_id", "user_settlement_reports", creator,
			fmt.Sprintf("(CASE WHEN COALESCE(l.order_id, 0) <> 0 THEN COALESCE(o.created_by_user_id, 0) WHEN l.user_id <> 0 THEN l.user_id ELSE l.actor_id END) = %d", creator))
	}

	t.Logf("lost rows claimed by the shop re-fold %d, by the person re-fold %d, the rest by their redelivery", claimedBy["shop"], claimedBy["person"])
}
