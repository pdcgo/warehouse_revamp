//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
)

// One withdrawal into an account a year deep, dated a week back — the listener's claim, lock, post and shift.
func TestPerf_WithdrawalHandler(t *testing.T) {
	b := perfSetup(t)

	shop := b.shopsBase + 500

	_, err := b.svc.FinancialAccountShopSet(asAni(), connect.NewRequest(&fa.FinancialAccountShopSetRequest{TeamId: b.team, ShopId: shop, AccountId: b.busy}))
	if err != nil {
		t.Fatalf("link: %v", err)
	}

	perfRun(t, b, "WithdrawalHandler", func(i int) error {
		return b.svc.WithdrawalHandler()(context.Background(), settlementEvent(fmt.Sprintf("perf-w-%d", i), b.team, shop, settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, -10_000, day(7)))
	})
}
