//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountUpdate(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountUpdate", func(i int) error {
		_, err := b.svc.FinancialAccountUpdate(asAni(), connect.NewRequest(&fa.FinancialAccountUpdateRequest{
			TeamId:     b.team,
			AccountId:  b.busy,
			Name:       fmt.Sprintf("Busy %d", i),
			HolderName: "PT Perf",
		}))
		return err
	})
}
