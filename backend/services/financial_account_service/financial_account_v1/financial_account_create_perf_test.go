//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountCreate(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountCreate", func(i int) error {
		_, err := b.svc.FinancialAccountCreate(asAni(), connect.NewRequest(&fa.FinancialAccountCreateRequest{
			TeamId:         b.team,
			Type:           fa.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT,
			Provider:       fa.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA,
			Name:           fmt.Sprintf("Perf New %d", i),
			AccountNumber:  fmt.Sprintf("NEW%04d", i+10),
			OpeningBalance: 1_000_000,
			OpeningOn:      day(3),
		}))
		return err
	})
}
