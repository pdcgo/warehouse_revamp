//go:build perfaudit

// Performance audit for the expense metrics' TYPE fields and the day RE-FOLD (backlog #107): a sort by one type field,
// a headline of every field, and `san report refold --report expense-daily` on a busy team's day — against
// TestPerf_ExpenseMetric's ~219 000 report rows, plus a year of one team's typed expense records.
//
//	go test -tags perfaudit -p 1 -run TestPerf_ExpenseMetricTypes -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// perfTypedRecords writes `perDay` typed expense records a day for a year for one team — each type in turn, its kind
// the type's group — and the corrections of a tenth of them, made the next day.
func perfTypedRecords(t *testing.T, db *gorm.DB, team uint64, perDay int) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	err := quiet.Exec(`
		INSERT INTO expense_records (team_id, kind, type, amount, occurred_at, created_by, finance_account_id, created_at)
		SELECT ?, CASE WHEN ty <= 2 THEN 1 WHEN ty <= 5 THEN 2 WHEN ty <= 12 THEN 3 ELSE 4 END, ty,
		       10000.5 * (1 + g % 9), CURRENT_DATE - d, 500 + g % 10, 7, NOW() - make_interval(days => d)
		FROM generate_series(0, 364) d CROSS JOIN generate_series(1, ?) g CROSS JOIN LATERAL (SELECT 1 + (g % 18) AS ty) x`,
		team, perDay).Error
	if err != nil {
		t.Fatalf("typed records: %v", err)
	}

	err = quiet.Exec(`
		INSERT INTO expense_records (team_id, kind, type, amount, occurred_at, created_by, finance_account_id, adjusts_expense_id, created_at)
		SELECT team_id, kind, type, -1000, occurred_at, created_by, 7, id, created_at + INTERVAL '1 day'
		FROM expense_records WHERE team_id = ? AND id % 10 = 0`, team).Error
	if err != nil {
		t.Fatalf("corrections: %v", err)
	}

	err = quiet.Exec("ANALYZE expense_records").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
}

func TestPerf_ExpenseMetricTypes(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfMetricBackground(t, db)

	const seller uint64 = 140

	perfTypedRecords(t, db, seller, 60)

	svc := newService(t, db)
	ctx := t.Context()
	today := time.Now()
	year := []*analytic_basev1.FilterItem{dateWindow(today.AddDate(0, 0, -364).Format("2006-01-02"), today.Format("2006-01-02"))}

	perfMetricRun(t, db, probe, "MetricSearch seller expenses by user, sorted by bank_fee-365d", func() error {
		_, err := svc.MetricSearch(ctx, connect.NewRequest(&expensev1.MetricSearchRequest{
			TeamId: seller, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_USER, Filters: year,
			Sort: &analytic_basev1.MetricSort{MetricId: metricExpenses, Field: "bank_fee"},
			Page: &analytic_basev1.PaginationFilter{Limit: 20},
		}))

		return err
	})

	perfMetricRun(t, db, probe, "MetricSearch root expenses by seller, sorted by prive-365d", func() error {
		_, err := svc.MetricSearch(ctx, connect.NewRequest(&expensev1.MetricSearchRequest{
			TeamId: 1, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_TEAM, Filters: year,
			Sort: &analytic_basev1.MetricSort{MetricId: metricExpenses, Field: "prive"},
			Page: &analytic_basev1.PaginationFilter{Limit: 20},
		}))

		return err
	})

	// The re-fold of a busy day: 60 records of the day and 6 corrections made that day, onto the day's report rows.
	day := today.AddDate(0, 0, -30).Format("2006-01-02")

	perfMetricRun(t, db, probe, "MetricDayRefold seller's busy day (dry run)", func() error {
		_, err := svc.MetricDayRefold(ctx, expense_v1.MetricDayRefoldInput{TeamID: seller, Day: day, DryRun: true})

		return err
	})

	perfMetricRun(t, db, probe, "MetricDayRefold seller's busy day", func() error {
		_, err := svc.MetricDayRefold(ctx, expense_v1.MetricDayRefoldInput{TeamID: seller, Day: day})

		return err
	})
}
