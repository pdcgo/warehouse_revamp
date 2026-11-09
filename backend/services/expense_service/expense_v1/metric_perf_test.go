//go:build perfaudit

// Performance audit for the EXPENSE METRICS (the audit-rpc-performance skill): MetricSearch and MetricData over
// `metrics/ads` and `metrics/expenses`, and the fold on the write path (ExpenseCreate, ExpenseAdjust) — against
// ~219 000 report rows: a year of days × 150 teams (30 of them warehouses) × kinds × people.
//
//	go test -tags perfaudit -p 1 -run TestPerf_ExpenseMetric -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// perfMetricBackground writes 600 rows a day for a year: team 100 + (g % 150) — 100–129 warehouses, the rest sellers —
// kind 1 + (g % 4), person 500 + (g % 10), an ads row's shop 900 + (g % 20). Each team holds a 150th.
func perfMetricBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	err := quiet.Exec(`
		INSERT INTO expense_metric_daily_reports (day, team_id, seller_id, warehouse_id, kind, shop_id, user_id, amount)
		SELECT CURRENT_DATE - d, 100 + (g % 150),
		       CASE WHEN g % 150 >= 30 THEN 100 + (g % 150) ELSE 0 END,
		       CASE WHEN g % 150 < 30 THEN 100 + (g % 150) ELSE 0 END,
		       1 + (g % 4), CASE WHEN g % 4 = 0 THEN 900 + ((g / 4) % 20) ELSE 0 END, 500 + ((g * 7) % 10),
		       25000.5 * (1 + g % 7)
		FROM generate_series(0, 364) d CROSS JOIN generate_series(1, 600) g
		ON CONFLICT DO NOTHING`).Error
	if err != nil {
		t.Fatalf("expense metric background: %v", err)
	}

	err = quiet.Exec("ANALYZE expense_metric_daily_reports").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
}

func perfMetricRun(t *testing.T, db *gorm.DB, probe *san_perf.Probe, name string, call func() error) {
	t.Helper()

	err := call()
	if err != nil {
		t.Fatalf("%s warm-up: %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)

	for run := 1; run <= 5; run++ {
		probe.Reset()

		var callErr error

		wall, dbTime := probe.Measure(func() { callErr = call() })
		if callErr != nil {
			t.Fatalf("%s run %d: %v", name, run, callErr)
		}

		walls = append(walls, wall)
		t.Logf("%s wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("%s MEDIAN wall %v", name, san_perf.Median(walls))
	probe.Report(t, name)

	// EXPLAIN only a read: EXPLAIN ANALYZE runs the statement.
	for _, q := range probe.Queries() {
		if !strings.HasPrefix(strings.TrimSpace(strings.ToUpper(q.SQL)), "SELECT") {
			continue
		}

		t.Log(san_perf.Explain(t, db, q.SQL))
	}
}

func TestPerf_ExpenseMetric(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfMetricBackground(t, db)

	svc := newService(t, db)
	ctx := t.Context()

	today := time.Now()
	window := func(from int) []*analytic_basev1.FilterItem {
		return []*analytic_basev1.FilterItem{dateWindow(today.AddDate(0, 0, -from).Format("2006-01-02"), today.Format("2006-01-02"))}
	}

	search := func(team uint64, group analytic_basev1.GroupType, from int, metric, field string) func() error {
		return func() error {
			_, err := svc.MetricSearch(ctx, connect.NewRequest(&expensev1.MetricSearchRequest{
				TeamId: team, GroupBy: group, Filters: window(from),
				Sort: &analytic_basev1.MetricSort{MetricId: metric, Field: field},
				Page: &analytic_basev1.PaginationFilter{Limit: 20},
			}))

			return err
		}
	}

	data := func(team uint64, group, rows analytic_basev1.GroupType, from int, keys *analytic_basev1.MetricKeys, metrics ...string) func() error {
		return func() error {
			_, err := svc.MetricData(ctx, connect.NewRequest(&expensev1.MetricDataRequest{
				TeamId: team, GroupBy: group, RowsGroup: rows, Filters: window(from), Keys: keys, MetricIds: metrics,
			}))

			return err
		}
	}

	days := make([]string, 0, 30)
	for d := range 30 {
		days = append(days, today.AddDate(0, 0, -d).Format("2006-01-02"))
	}

	shops := make([]uint64, 0, 20)
	for i := range 20 {
		shops = append(shops, 900+uint64(i))
	}

	sellers := make([]uint64, 0, 20)
	for i := range 20 {
		sellers = append(sellers, 130+uint64(i))
	}

	const seller uint64 = 140

	summary := analytic_basev1.GroupType_GROUP_TYPE_SUMMARY
	none := analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED

	perfMetricRun(t, db, probe, "MetricSearch seller ads by shop-365d", search(seller, analytic_basev1.GroupType_GROUP_TYPE_SHOP, 364, metricAds, "amount"))
	perfMetricRun(t, db, probe, "MetricSearch seller expenses by user-365d", search(seller, analytic_basev1.GroupType_GROUP_TYPE_USER, 364, metricExpenses, "total"))
	perfMetricRun(t, db, probe, "MetricSearch seller expenses daily-30d", search(seller, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 29, metricExpenses, "payroll"))
	perfMetricRun(t, db, probe, "MetricSearch root expenses by seller-365d", search(1, analytic_basev1.GroupType_GROUP_TYPE_TEAM, 364, metricExpenses, "total"))
	perfMetricRun(t, db, probe, "MetricData seller ads by shop-365d", data(seller, analytic_basev1.GroupType_GROUP_TYPE_SHOP, none, 364, idKeys(shops...), metricAds))
	perfMetricRun(t, db, probe, "MetricData seller both daily-30d", data(seller, analytic_basev1.GroupType_GROUP_TYPE_DAILY, none, 29, dayKeys(days...), metricAds, metricExpenses))
	perfMetricRun(t, db, probe, "MetricData seller summary-365d", data(seller, summary, none, 364, nil, metricAds, metricExpenses))
	perfMetricRun(t, db, probe, "MetricData root by seller-365d", data(1, analytic_basev1.GroupType_GROUP_TYPE_TEAM, none, 364, idKeys(sellers...), metricExpenses))
	perfMetricRun(t, db, probe, "MetricData root headline by seller-365d", data(1, summary, analytic_basev1.GroupType_GROUP_TYPE_TEAM, 364, nil, metricExpenses))

	// THE WRITE PATH: the fold is one upsert in the expense's own transaction.
	budi := asCaller(userBudi, seller, role_basev1.Role_ROLE_SELLING_OWNER)

	var lastExpense uint64

	perfMetricRun(t, db, probe, "ExpenseCreate ads (with the fold)", func() error {
		res, err := svc.ExpenseCreate(budi, connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: seller, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Amount: 250_000, OccurredAt: today.Format("2006-01-02"),
			ShopId: 905, FinanceAccountId: payingAccount,
		}))
		if err == nil {
			lastExpense = res.Msg.GetExpense().GetId()
		}

		return err
	})

	perfMetricRun(t, db, probe, "ExpenseAdjust (with the fold)", func() error {
		_, err := svc.ExpenseAdjust(budi, connect.NewRequest(&expensev1.ExpenseAdjustRequest{
			TeamId: seller, ExpenseId: lastExpense, Amount: -1_000,
		}))

		return err
	})
}
