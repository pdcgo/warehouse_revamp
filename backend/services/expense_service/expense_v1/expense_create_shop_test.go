package expense_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// settlement-and-expense-ask-the-shop-first, expense's half: before an expense stores a shop, the shop is asked whether
// it is one of the team's. Another team's shop, or one that does not exist, is NotFound and nothing is stored — no row,
// no Analytic figure, no event. A closed shop is taken, an expense naming no shop asks nothing, and who in the team may
// spend is unchanged.
//
// The real ShopAccessCheck behind the seam (a closed shop answered, another team's NotFound) is exercised in
// backend/cmd/app_development/expense_shops_test.go.

func adsOn(shopID uint64) *connect.Request[expensev1.ExpenseCreateRequest] {
	return connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Amount: 250_000, OccurredAt: "2026-11-18",
		ShopId: shopID, FinanceAccountId: payingAccount,
	})
}

func TestExpenseCreate_RefusesAShopThatIsNotTheTeams(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	asked := 0
	svc := expense_v1.NewService(db, sent.send, fakeAccounts{}, fakeSides{}, fakeShops{asked: &asked})

	for _, tc := range []struct {
		name string
		shop uint64
	}{
		{"another team's shop", otherTeamsShop},
		{"a shop that does not exist", unknownShop},
	} {
		_, err := svc.ExpenseCreate(context.Background(), adsOn(tc.shop))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s: code = %v (%v), want not_found", tc.name, connect.CodeOf(err), err)
		}

		// The two read the same — the answer names only the id it was given, never whose it is.
		if !strings.Contains(err.Error(), "is not one of this team's shops") {
			t.Errorf("%s: %q — want the shop named as not one of this team's", tc.name, err.Error())
		}
	}

	if asked != 2 {
		t.Errorf("the shop was asked %d times, want 2", asked)
	}

	var rows int64

	err := db.Model(&expense_service_models.ExpenseRecord{}).Where("team_id = ?", teamA).Count(&rows).Error
	if err != nil {
		t.Fatalf("count expenses: %v", err)
	}

	var figures int64

	err = db.Table("expense_metric_daily_reports").Where("team_id = ?", teamA).Count(&figures).Error
	if err != nil {
		t.Fatalf("count figures: %v", err)
	}

	if rows != 0 || figures != 0 || len(sent.events) != 0 {
		t.Fatalf("%d rows, %d Analytic figures and %d events after the refusals, want none", rows, figures, len(sent.events))
	}
}

// The team's own shop is taken — open or closed (an expense is money still running on a closed shop) — and asked once.
func TestExpenseCreate_TakesTheTeamsOwnShopOpenOrClosed(t *testing.T) {
	db := san_testdb.DB(t)
	asked := 0
	svc := expense_v1.NewService(db, nil, fakeAccounts{}, fakeSides{}, fakeShops{asked: &asked})

	for _, shop := range []uint64{adsShop, closedShop} {
		res, err := svc.ExpenseCreate(context.Background(), adsOn(shop))
		if err != nil {
			t.Fatalf("shop %d: %v", shop, err)
		}

		if res.Msg.GetExpense().GetShopId() != shop {
			t.Errorf("stored shop = %d, want %d", res.Msg.GetExpense().GetShopId(), shop)
		}
	}

	if asked != 2 {
		t.Errorf("the shop was asked %d times, want once per expense", asked)
	}
}

// An expense naming no shop (every kind but ADS) is stored exactly as before, and the shop is never asked — not even a
// shop service that refuses everything stands in its way.
func TestExpenseCreate_NoShopAsksNothing(t *testing.T) {
	db := san_testdb.DB(t)
	asked := 0
	// No shop service at all would refuse every shop, so the write proves the shop was never asked.
	svc := expense_v1.NewService(db, nil, fakeAccounts{}, fakeSides{}, nil)
	counting := expense_v1.NewService(db, nil, fakeAccounts{}, fakeSides{}, fakeShops{asked: &asked})

	for _, s := range []*expense_v1.Service{svc, counting} {
		res, err := s.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, Amount: 1_000_000, OccurredAt: "2026-11-18",
			FinanceAccountId: payingAccount,
		}))
		if err != nil {
			t.Fatalf("payroll with no shop: %v", err)
		}

		if res.Msg.GetExpense().GetShopId() != 0 {
			t.Errorf("stored shop = %d, want 0", res.Msg.GetExpense().GetShopId())
		}
	}

	if asked != 0 {
		t.Errorf("the shop was asked %d times for expenses naming none", asked)
	}
}
