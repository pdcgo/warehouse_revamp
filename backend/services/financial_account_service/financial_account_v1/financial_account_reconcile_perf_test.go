//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountReconcile(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountReconcile", func(i int) error {
		_, err := b.svc.FinancialAccountReconcile(asAni(), connect.NewRequest(&fa.FinancialAccountReconcileRequest{
			TeamId:        b.team,
			AccountId:     b.busy,
			ActualBalance: float64(900_000 + i*1_000),
			AsOf:          day(0),
			Note:          "perf",
		}))
		return err
	})
}
