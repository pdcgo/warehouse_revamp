//go:build perfaudit

// go test -tags perfaudit -run TestPerf_FinancialAccountReportExport -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"testing"
	"time"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// The account report's export over the seed its reads were audited on (50 accounts × 365 days for the team): Periode
// a month and a year by day (two steps of 200 periods) and a year by month, one account's year, and Rincian over a
// month and a year — each the report's own two statements (the series) or one (the window per account), then the file.
func TestPerf_FinancialAccountReportExport(t *testing.T) {
	b := perfSetup(t)
	store := &fakeReportExports{}
	svc := financial_account_v1.NewService(b.db, anyShop{}, store)

	// The seed's days are UTC dates of today; the window is laid out from the same day.
	today := time.Now().UTC()
	span := func(from int) *analytic_basev1.FilterItem {
		return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_DateRangeFilter{DateRangeFilter: &analytic_basev1.DateRangeFilter{
			DateMin: today.AddDate(0, 0, -from).Format("2006-01-02"), DateMax: today.Format("2006-01-02"),
		}}}
	}

	period := fa.FinancialAccountReportView_FINANCIAL_ACCOUNT_REPORT_VIEW_PERIOD
	breakdown := fa.FinancialAccountReportView_FINANCIAL_ACCOUNT_REPORT_VIEW_BREAKDOWN

	for _, c := range []struct {
		name    string
		view    fa.FinancialAccountReportView
		group   analytic_basev1.GroupType
		from    int
		account uint64
	}{
		{"periode/daily-30d", period, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 29, 0},
		{"periode/daily-365d", period, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 364, 0},
		{"periode/monthly-365d", period, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, 364, 0},
		{"periode/daily-365d/one-account", period, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 364, b.busy},
		{"rincian/30d", breakdown, analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED, 29, 0},
		{"rincian/365d", breakdown, analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED, 364, 0},
	} {
		filters := []*analytic_basev1.FilterItem{span(c.from)}
		if c.account != 0 {
			filters = append(filters, accountsFilter(c.account))
		}

		perfRun(t, b, "FinancialAccountReportExport/"+c.name, func(int) error {
			_, err := runReportExport(t, svc, store, &fa.FinancialAccountReportExportRequest{
				TeamId: b.team, View: c.view, Filters: filters, GroupBy: c.group,
				SortType: analytic_basev1.SortType_SORT_TYPE_DESC,
			})

			return err
		})
	}
}
