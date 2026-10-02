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

func TestPerf_AnalyticGroupSearch(t *testing.T) {
	b := perfSetup(t)

	for _, g := range []fa.AnalyticGroupType{
		fa.AnalyticGroupType_ANALYTIC_GROUP_TYPE_ACCOUNT,
		fa.AnalyticGroupType_ANALYTIC_GROUP_TYPE_PROVIDER,
		fa.AnalyticGroupType_ANALYTIC_GROUP_TYPE_CHANGE_TYPE,
	} {
		perfRun(t, b, "AnalyticGroupSearch/"+g.String(), func(int) error {
			_, err := b.svc.AnalyticGroupSearch(context.Background(), connect.NewRequest(&fa.AnalyticGroupSearchRequest{
				TeamId: b.team,
				Filter: &fa.AnalyticGroupFilter{DateRange: window(364, 0), GroupType: g},
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
			return err
		})
	}
}
