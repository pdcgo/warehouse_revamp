//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountOperationalSet(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountOperationalSet", func(i int) error {
		_, err := b.svc.FinancialAccountOperationalSet(asAni(), connect.NewRequest(&fa.FinancialAccountOperationalSetRequest{
			TeamId:      b.team,
			AccountId:   b.accounts[10].ID,
			Operational: i%2 == 0,
		}))
		return err
	})
}
