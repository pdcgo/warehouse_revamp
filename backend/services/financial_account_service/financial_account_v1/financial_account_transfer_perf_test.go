//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// Today, and dated 200 days back — a LATE row, so every later day of both accounts shifts: the write path's
// worst case.
func TestPerf_FinancialAccountTransfer(t *testing.T) {
	b := perfSetup(t)

	for _, ago := range []int{0, 200} {
		perfRun(t, b, fmt.Sprintf("FinancialAccountTransfer/dated=%dd-ago", ago), func(int) error {
			_, err := b.svc.FinancialAccountTransfer(asAni(), connect.NewRequest(&fa.FinancialAccountTransferRequest{
				TeamId:        b.team,
				FromAccountId: b.accounts[1].ID,
				ToAccountId:   b.busy,
				Amount:        10_000,
				OccurredOn:    day(ago),
			}))
			return err
		})
	}
}
