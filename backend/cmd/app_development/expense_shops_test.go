package main

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// everyAccountPays answers every account as the team's active operational one: these tests are about the shop.
type everyAccountPays struct{}

func (everyAccountPays) Account(context.Context, uint64, uint64) (expense_v1.PayingAccount, bool, error) {
	return expense_v1.PayingAccount{Name: "Scope BCA", Active: true, Operational: true}, true, nil
}

// expense's half of settlement-and-expense-ask-the-shop-first, through NewExpenseShops over selling's REAL
// ShopAccessCheck (shopScopeServer): an ADS expense on the team's open or CLOSED shop is stored — an expense is money
// still running on a closed shop — while another team's shop and one that never existed are NotFound, nothing stored.
func TestExpenseShops_TheRealShopAnswersForTheTeam(t *testing.T) {
	db := san_testdb.DB(t)
	client, shops := shopScopeServer(t, db)
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: scopePrimary})

	adapter := NewExpenseShops(client)

	for _, c := range []struct {
		name string
		shop uint64
		want bool
	}{
		{"the team's open shop", shops.open, true},
		{"the team's closed shop", shops.closed, true},
		{"another team's shop", shops.others, false},
		{"a shop that never existed", shops.unknown, false},
	} {
		found, err := adapter.ShopOfTeam(ctx, scopeTeam, c.shop)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		if found != c.want {
			t.Errorf("%s: found = %v, want %v", c.name, found, c.want)
		}
	}

	// Through ExpenseCreate itself.
	expenses := expense_v1.NewService(db, nil, everyAccountPays{}, nil, adapter)

	ads := func(shopID uint64) *connect.Request[expensev1.ExpenseCreateRequest] {
		return connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: scopeTeam, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Type: expensev1.ExpenseType_EXPENSE_TYPE_ADS_MARKETPLACE,
			Amount: 125_000, OccurredAt: "2026-11-18",
			ShopId: shopID, FinanceAccountId: 1,
		})
	}

	res, err := expenses.ExpenseCreate(ctx, ads(shops.closed))
	if err != nil {
		t.Fatalf("an ADS expense on the team's closed shop: %v — want it stored", err)
	}

	if res.Msg.GetExpense().GetShopId() != shops.closed {
		t.Errorf("stored shop = %d, want %d", res.Msg.GetExpense().GetShopId(), shops.closed)
	}

	for _, refused := range []uint64{shops.others, shops.unknown} {
		_, err = expenses.ExpenseCreate(ctx, ads(refused))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("an ADS expense on shop %d: code = %v (%v), want not_found", refused, connect.CodeOf(err), err)
		}

		var stored int64

		err = db.
			Model(&expense_service_models.ExpenseRecord{}).
			Where("shop_id = ?", refused).
			Count(&stored).
			Error
		if err != nil {
			t.Fatalf("count expenses: %v", err)
		}

		if stored != 0 {
			t.Errorf("%d expenses stored on shop %d, want none", stored, refused)
		}
	}
}

// With no caller to ride on, the adapter asks nothing and refuses — never a shop trusted on no one's word.
func TestExpenseShops_NoCallerIsAnError(t *testing.T) {
	db := san_testdb.DB(t)
	client, shops := shopScopeServer(t, db)

	_, err := NewExpenseShops(client).ShopOfTeam(context.Background(), scopeTeam, shops.open)
	if err == nil {
		t.Fatal("ShopOfTeam with no caller answered, want an error")
	}
}
