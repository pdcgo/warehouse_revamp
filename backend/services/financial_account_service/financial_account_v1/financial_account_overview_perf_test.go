//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountOverview(t *testing.T) {
	b := perfSetup(t)

	ids := []uint64{}
	for _, a := range b.accounts {
		ids = append(ids, a.ID)
	}

	perfRun(t, b, "FinancialAccountOverview", func(int) error {
		_, err := b.svc.FinancialAccountOverview(context.Background(), connect.NewRequest(&fa.FinancialAccountOverviewRequest{
			TeamId: b.team,
			Filter: &fa.FinancialAccountOverviewFilter{AccountIds: ids},
			MetricRequest: []fa.FinancialAccountMetricDataType{
				fa.FinancialAccountMetricDataType_FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_BALANCE,
				fa.FinancialAccountMetricDataType_FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_TYPE_TOTAL,
			},
		}))
		return err
	})
}
