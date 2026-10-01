//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestPerf_FinancialAccountShopSet(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "FinancialAccountShopSet", func(i int) error {
		_, err := b.svc.FinancialAccountShopSet(asAni(), connect.NewRequest(&fa.FinancialAccountShopSetRequest{
			TeamId:    b.team,
			ShopId:    b.shopsBase + uint64(i+1),
			AccountId: b.busy,
		}))
		return err
	})
}
