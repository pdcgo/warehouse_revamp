//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_AnalyticGroupMetric(t *testing.T) {
	b := perfSetup(t)

	keys := []*fa.AnalyticGroupKey{}
	for _, a := range b.accounts[:20] {
		keys = append(keys, &fa.AnalyticGroupKey{Key: &fa.AnalyticGroupKey_AccountId{AccountId: a.ID}})
	}

	perfRun(t, b, "AnalyticGroupMetric/20-accounts-365d", func(int) error {
		_, err := b.svc.AnalyticGroupMetric(context.Background(), connect.NewRequest(&fa.AnalyticGroupMetricRequest{
			TeamId: b.team,
			Filter: &fa.AnalyticGroupFilter{DateRange: window(364, 0), GroupType: fa.AnalyticGroupType_ANALYTIC_GROUP_TYPE_ACCOUNT},
			Keys:   keys,
		}))
		return err
	})
}
