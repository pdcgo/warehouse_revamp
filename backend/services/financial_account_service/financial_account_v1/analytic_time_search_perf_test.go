//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// A month daily, a year daily at two page sizes, a year monthly — and a month of one account.
func TestPerf_AnalyticTimeSearch(t *testing.T) {
	b := perfSetup(t)

	cases := []struct {
		name      string
		from      int
		timeframe fa.AnalyticTimeframe
		limit     uint32
		account   uint64
	}{
		{"daily-30d", 29, fa.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY, 20, 0},
		{"daily-365d/limit=20", 364, fa.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY, 20, 0},
		{"daily-365d/limit=200", 364, fa.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY, 200, 0},
		{"monthly-365d", 364, fa.AnalyticTimeframe_ANALYTIC_TIMEFRAME_MONTHLY, 20, 0},
		{"daily-30d/one-account", 29, fa.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY, 20, b.busy},
	}

	for _, c := range cases {
		perfRun(t, b, "AnalyticTimeSearch/"+c.name, func(int) error {
			_, err := b.svc.AnalyticTimeSearch(context.Background(), connect.NewRequest(&fa.AnalyticTimeSearchRequest{
				TeamId:    b.team,
				Timeframe: c.timeframe,
				Filter:    &fa.AnalyticTimeSearchFilter{DateRange: window(c.from, 0), AccountId: c.account},
				SortType:  commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
				Page:      &commonv1.CommonPagination{Page: 1, Limit: c.limit},
			}))
			return err
		})
	}
}
