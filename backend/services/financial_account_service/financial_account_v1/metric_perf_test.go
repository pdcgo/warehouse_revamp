//go:build perfaudit

// go test -tags perfaudit -run TestPerf_FinanceMetric -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// The probe of the-balance-series-is-a-running-sum, on the seed AnalyticTimeSearch was audited on (50 accounts × 365
// days for the team): the same five series — a month daily, a year daily at a page of 20 and of 200, a year monthly, a
// month of one account — now a page of MetricData, plus the searches and the headline the screens ask beside them.
func TestPerf_FinanceMetric(t *testing.T) {
	b := perfSetup(t)

	// The seed's days are UTC dates of today; the window is laid out from the same day.
	today := time.Now().UTC()
	span := func(from int) *analytic_basev1.FilterItem {
		return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_DateRangeFilter{DateRangeFilter: &analytic_basev1.DateRangeFilter{
			DateMin: today.AddDate(0, 0, -from).Format("2006-01-02"), DateMax: today.Format("2006-01-02"),
		}}}
	}

	// A page of period keys, newest first — what the Financial Account Report asks.
	pageOf := func(from, limit int, group analytic_basev1.GroupType) []string {
		days := []string{}

		for d := 0; d <= from && len(days) < limit; d++ {
			day := today.AddDate(0, 0, -d)

			switch group {
			case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
				day = time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, time.UTC)
			}

			key := day.Format("2006-01-02")
			if len(days) == 0 || days[len(days)-1] != key {
				days = append(days, key)
			}
		}

		return days
	}

	series := []struct {
		name    string
		from    int
		group   analytic_basev1.GroupType
		limit   int
		account uint64
	}{
		{"daily-30d", 29, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 20, 0},
		{"daily-365d/limit=20", 364, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 20, 0},
		{"daily-365d/limit=200", 364, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 200, 0},
		{"monthly-365d", 364, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, 20, 0},
		{"daily-30d/one-account", 29, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 20, b.busy},
	}

	for _, c := range series {
		filters := []*analytic_basev1.FilterItem{span(c.from)}
		if c.account != 0 {
			filters = append(filters, accountsFilter(c.account))
		}

		days := pageOf(c.from, c.limit, c.group)

		perfRun(t, b, "MetricData/"+c.name, func(int) error {
			_, err := b.svc.MetricData(context.Background(), connect.NewRequest(&fa.MetricDataRequest{
				TeamId: b.team, GroupBy: c.group, Filters: filters, Keys: dayKeys(days...),
				MetricIds: []string{metricChanges, metricTypes},
			}))

			return err
		})
	}

	perfRun(t, b, "MetricData/summary-365d", func(int) error {
		_, err := b.svc.MetricData(context.Background(), connect.NewRequest(&fa.MetricDataRequest{
			TeamId: b.team, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, Filters: []*analytic_basev1.FilterItem{span(364)},
			MetricIds: []string{metricChanges, metricTypes},
		}))

		return err
	})

	searches := []struct {
		name   string
		group  analytic_basev1.GroupType
		metric string
		field  string
	}{
		{"daily-365d/by-closing", analytic_basev1.GroupType_GROUP_TYPE_DAILY, metricChanges, "closing_balance"},
		{"account-365d/by-change", analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, metricChanges, "change"},
		{"provider-365d/by-closing", analytic_basev1.GroupType_GROUP_TYPE_PROVIDER, metricChanges, "closing_balance"},
		{"change-type-365d/by-amount", analytic_basev1.GroupType_GROUP_TYPE_CHANGE_TYPE, metricTypes, "amount"},
	}

	for _, c := range searches {
		perfRun(t, b, "MetricSearch/"+c.name, func(int) error {
			_, err := b.svc.MetricSearch(context.Background(), connect.NewRequest(&fa.MetricSearchRequest{
				TeamId: b.team, GroupBy: c.group, Filters: []*analytic_basev1.FilterItem{span(364)},
				Sort: &analytic_basev1.MetricSort{MetricId: c.metric, Field: c.field},
				Page: &analytic_basev1.PaginationFilter{Limit: 20},
			}))

			return err
		})
	}
}
