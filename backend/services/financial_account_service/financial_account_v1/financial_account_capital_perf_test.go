//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountCapital(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountCapital", func(int) error {
		_, err := b.svc.FinancialAccountCapital(asAni(), connect.NewRequest(&fa.FinancialAccountCapitalRequest{
			TeamId:     b.team,
			AccountId:  b.busy,
			Direction:  fa.CapitalDirection_CAPITAL_DIRECTION_IN,
			Amount:     10_000,
			OccurredOn: day(0),
		}))
		return err
	})
}
