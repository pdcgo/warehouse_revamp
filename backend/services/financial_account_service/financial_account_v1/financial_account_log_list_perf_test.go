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

// The busy account holds 20 000 rows: two page sizes newest first, then one type over a month.
func TestPerf_FinancialAccountLogList(t *testing.T) {
	b := perfSetup(t)

	for _, size := range []uint32{20, 200} {
		perfRun(t, b, fmt.Sprintf("FinancialAccountLogList/limit=%d", size), func(int) error {
			_, err := b.svc.FinancialAccountLogList(context.Background(), connect.NewRequest(&fa.FinancialAccountLogListRequest{
				TeamId: b.team,
				Filter: &fa.FinancialAccountLogListFilter{AccountId: b.busy},
				Page:   &commonv1.CommonPagination{Page: 1, Limit: size},
			}))
			return err
		})
	}

	perfRun(t, b, "FinancialAccountLogList/type+month", func(int) error {
		_, err := b.svc.FinancialAccountLogList(context.Background(), connect.NewRequest(&fa.FinancialAccountLogListRequest{
			TeamId: b.team,
			Filter: &fa.FinancialAccountLogListFilter{
				AccountId:    b.busy,
				ChangeTypes:  []fa.FinancialAccountChangeType{fa.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_WITHDRAWAL},
				OccurredFrom: day(30),
				OccurredTo:   day(0),
			},
			Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		return err
	})
}
