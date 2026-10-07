//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// Each run moves one unknown account (50 000 in it) into the busy account — the heavier of the two ways: a
// transfer, a re-point and an archive in one transaction.
func TestPerf_FinancialAccountIdentify(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountIdentify/move-in", func(i int) error {
		_, err := b.svc.FinancialAccountIdentify(asAni(), connect.NewRequest(&fa.FinancialAccountIdentifyRequest{
			TeamId:    b.team,
			AccountId: b.unknowns[i+1],
			Target:    &fa.FinancialAccountIdentifyRequest_MoveIntoAccountId{MoveIntoAccountId: b.busy},
		}))
		return err
	})
}
