//go:build raceaudit

// Concurrency audit for the EXPENSE-METRICS FOLD (metric_fold.go — expense-figures-are-read-from-its-own-records): every
// typed expense, correction and cancel adds its signed amount to one `expense_metric_daily_reports` row in its own
// transaction, with one INSERT … ON CONFLICT DO UPDATE. Many entries at one second land on ONE report row — the same
// day, team, kind, shop and person — and none may be lost; the row must never deadlock against ExpenseAdjust's expense
// row lock. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_MetricFold|TestInterleave_MetricFold" -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// The day every racer writes on: the expenses BELONG to it and the corrections are MADE on it, so all of them meet in
// one report row.
const raceDay = "2026-10-20"

func raceClock() time.Time {
	return wibAt(raceDay, 10)
}

// raceTeam is a fresh team per test, cleaned from both tables afterwards (the other suites' rows are left alone).
func raceTeam(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	team := uint64(800_000 + time.Now().UnixNano()%100_000)

	t.Cleanup(func() {
		db.Where("team_id = ?", team).Delete(&expense_service_models.ExpenseRecord{})
		db.Where("team_id = ?", team).Delete(&expense_service_models.ExpenseMetricDailyReport{})
	})

	return team
}

func raceCreate(svc *expense_v1.Service, team uint64, amount float64) (uint64, error) {
	res, err := svc.ExpenseCreate(asCaller(userBudi, team, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: team, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Amount: amount, OccurredAt: raceDay,
		ShopId: adsShop, FinanceAccountId: payingAccount,
	}))
	if err != nil {
		return 0, err
	}

	return res.Msg.GetExpense().GetId(), nil
}

func raceCorrect(svc *expense_v1.Service, team, expense uint64, amount float64) error {
	_, err := svc.ExpenseAdjust(asCaller(userBudi, team, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&expensev1.ExpenseAdjustRequest{
		TeamId: team, ExpenseId: expense, Amount: amount,
	}))

	return err
}

// theRow is the team's report — its one row's amount, and how many rows — beside the sum of its expense records.
func theRow(t *testing.T, db *gorm.DB, team uint64) (reported float64, rows int64, recorded float64) {
	t.Helper()

	db.Model(&expense_service_models.ExpenseMetricDailyReport{}).Where("team_id = ?", team).Count(&rows)
	db.Model(&expense_service_models.ExpenseMetricDailyReport{}).Where("team_id = ?", team).
		Select("COALESCE(SUM(amount), 0)").Scan(&reported)
	db.Model(&expense_service_models.ExpenseRecord{}).Where("team_id = ?", team).
		Select("COALESCE(SUM(amount), 0)").Scan(&recorded)

	return reported, rows, recorded
}

// ONE ROW, MANY ENTRIES: sixteen at one instant on one day row — eight new ads of 100.000,25 and eight corrections of
// −300.000 to eight earlier ads of 1.000.000 (a cancel-like correction per expense, so none is refused at the floor).
// Every one adds; none is lost, none deadlocks. The report equals the records, exactly.
func TestRace_MetricFold_CreatesAndCorrectionsOnOneDayRow(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc := newService(t, db)
	expense_v1.SetClock(svc, raceClock)

	team := raceTeam(t, db)

	for round := range 10 {
		earlier := make([]uint64, 0, 8)

		for range 8 {
			id, err := raceCreate(svc, team, 1_000_000)
			if err != nil {
				t.Fatalf("round %d: seed: %v", round, err)
			}

			earlier = append(earlier, id)
		}

		res := h.Race(t, 16, func(i int) error {
			if i%2 == 0 {
				_, err := raceCreate(svc, team, 100_000.25)

				return err
			}

			return raceCorrect(svc, team, earlier[i/2], -300_000)
		})

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of 16 failed — none conflicts with another", round, res.Failed())
		}

		reported, rows, recorded := theRow(t, db, team)
		want := float64(round+1) * (8*1_000_000 + 8*100_000.25 - 8*300_000)

		if rows != 1 || !san_money.Equal(reported, recorded) || !san_money.Equal(reported, want) {
			t.Fatalf("round %d: %d report rows reading %v, records %v — want one row reading %v, equal to the records",
				round, rows, reported, recorded, want)
		}
	}
}

// TWO CORRECTIONS OF TWO EXPENSES, ONE REPORT ROW, IN THE ORDER THAT COULD HURT: A locks its expense and writes the row;
// B — another expense, so no expense lock in common — BLOCKS on the report row until A commits, then adds on top. Each
// takes its expense row first and the report row last, so no two writers can wait on each other in a circle.
func TestInterleave_MetricFold_TheSecondCorrectionQueuesOnTheRow(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()

	setup := newService(t, db)
	expense_v1.SetClock(setup, raceClock)

	team := raceTeam(t, db)

	first, err := raceCreate(setup, team, 1_000_000)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	second, err := raceCreate(setup, team, 1_000_000)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	on := func(tx *gorm.DB) *expense_v1.Service {
		svc := newService(t, tx)
		expense_v1.SetClock(svc, raceClock)

		return svc
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A corrects the first", func(tx *gorm.DB) error {
			return raceCorrect(on(tx), team, first, -400_000)
		}),
		san_race.Block("B", "B corrects the second", func(tx *gorm.DB) error {
			return raceCorrect(on(tx), team, second, -250_000)
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get("B corrects the second")
	if !b.Blocked || !b.Released || b.Err != nil {
		t.Fatalf("B: blocked %v, released %v, err %v — want it to queue on the row and land", b.Blocked, b.Released, b.Err)
	}

	reported, rows, recorded := theRow(t, db, team)
	if rows != 1 || reported != 1_350_000 || reported != recorded {
		t.Fatalf("%d rows reading %v, records %v — want one row at 1.350.000", rows, reported, recorded)
	}
}
