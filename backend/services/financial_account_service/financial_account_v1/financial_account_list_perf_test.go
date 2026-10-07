//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// Two page sizes — a query count that moves with the page is an N+1.
func TestPerf_FinancialAccountList(t *testing.T) {
	b := perfSetup(t)

	for _, size := range []uint32{20, 200} {
		perfRun(t, b, fmt.Sprintf("FinancialAccountList/limit=%d", size), func(int) error {
			_, err := b.svc.FinancialAccountList(context.Background(), connect.NewRequest(&fa.FinancialAccountListRequest{
				TeamId:      b.team,
				Filter:      &fa.FinancialAccountListFilter{IncludeArchived: true},
				DataRequest: []fa.FinancialAccountListDataType{fa.FinancialAccountListDataType_FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT},
				Page:        &commonv1.CommonPagination{Page: 1, Limit: size},
			}))
			return err
		})
	}

	perfRun(t, b, "FinancialAccountList/picker-operational", func(int) error {
		_, err := b.svc.FinancialAccountList(context.Background(), connect.NewRequest(&fa.FinancialAccountListRequest{
			TeamId: b.team,
			Filter: &fa.FinancialAccountListFilter{OperationalOnly: true},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 200},
		}))
		return err
	})
}
