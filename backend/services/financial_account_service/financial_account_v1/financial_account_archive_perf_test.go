//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountArchive(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountArchive", func(i int) error {
		_, err := b.svc.FinancialAccountArchive(asAni(), connect.NewRequest(&fa.FinancialAccountArchiveRequest{TeamId: b.team, AccountId: b.zeros[i+1]}))
		return err
	})
}
