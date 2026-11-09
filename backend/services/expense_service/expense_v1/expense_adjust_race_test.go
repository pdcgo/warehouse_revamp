//go:build raceaudit

package expense_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// The concurrency audit of ExpenseAdjust (audit-sql). Its rule is a FLOOR read across rows — an expense and its
// adjustments never sum below 0 — which is the check-then-act a lock exists for: two corrections reading the same net
// would each pass and together cross it. The handler locks the expense row for the check and the write.
//
// Eight people correct one 1.000.000 expense by −300.000 at the same instant. Exactly three may land; the other five are
// refused as FailedPrecondition, and the expense ends at 100.000 — never below 0.
const racers = 8

func TestRace_ExpenseAdjust_TheFloorHolds(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc := newService(t, db)

	team := uint64(900_000 + time.Now().UnixNano()%100_000)

	t.Cleanup(func() {
		db.Where("team_id = ?", team).Delete(&expense_service_models.ExpenseRecord{})
		// Its Analytic report rows too (metric_fold.go), or the next suite reads them.
		db.Where("team_id = ?", team).Delete(&expense_service_models.ExpenseMetricDailyReport{})
	})

	for round := 0; round < 20; round++ {
		created, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: team, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Amount: 1_000_000, OccurredAt: "2026-09-28",
			ShopId: adsShop, FinanceAccountId: payingAccount,
		}))
		if err != nil {
			t.Fatalf("round %d: create: %v", round, err)
		}

		expense := created.Msg.GetExpense().GetId()

		res := h.Race(t, racers, func(int) error {
			_, err := svc.ExpenseAdjust(context.Background(), connect.NewRequest(&expensev1.ExpenseAdjustRequest{
				TeamId: team, ExpenseId: expense, Amount: -300_000,
			}))
			return err
		})

		refused := 0
		for _, o := range res.Outcomes {
			if o.Err != nil && connect.CodeOf(o.Err) == connect.CodeFailedPrecondition {
				refused++
			}
		}

		if landed := racers - res.Failed(); landed != 3 || refused != racers-3 {
			res.Report(t)
			t.Fatalf("round %d: %d landed and %d refused at the floor, want 3 and %d", round, landed, refused, racers-3)
		}

		var net float64

		err = db.Model(&expense_service_models.ExpenseRecord{}).
			Select("COALESCE(SUM(amount), 0)").
			Where("id = ? OR adjusts_expense_id = ?", expense, expense).
			Scan(&net).
			Error
		if err != nil {
			t.Fatalf("round %d: sum: %v", round, err)
		}

		if net != 100_000 {
			t.Fatalf("round %v: the expense ends at %v, want 100.000 — three corrections of −300.000", round, net)
		}
	}
}
