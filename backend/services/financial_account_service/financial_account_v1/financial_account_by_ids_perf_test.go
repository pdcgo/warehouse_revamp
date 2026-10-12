//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountByIds(t *testing.T) {
	b := perfSetup(t)

	for _, n := range []int{5, 40} {
		ids := []uint64{}
		for _, a := range b.accounts[:n] {
			ids = append(ids, a.ID)
		}

		perfRun(t, b, fmt.Sprintf("FinancialAccountByIds/ids=%d", n), func(int) error {
			_, err := b.svc.FinancialAccountByIds(context.Background(), connect.NewRequest(&fa.FinancialAccountByIdsRequest{
				TeamId: b.team,
				Filter: &fa.FinancialAccountByIdsFilter{Ids: ids},
			}))
			return err
		})
	}
}
