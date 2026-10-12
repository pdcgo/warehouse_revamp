//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountRestore(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountRestore", func(i int) error {
		_, err := b.svc.FinancialAccountRestore(asAni(), connect.NewRequest(&fa.FinancialAccountRestoreRequest{TeamId: b.team, AccountId: b.archived[i+1]}))
		return err
	})
}
