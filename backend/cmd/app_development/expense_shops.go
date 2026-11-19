package main

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// expenseShops answers expense's Shops — whether the shop an expense names is one of the team's
// (settlement-and-expense-ask-the-shop-first) — by asking the shop: ShopAccessCheck over Connect under the CALLER's
// token (NewShopClient forwards it). A client, not the handler in-process, for the reason NewShopClient gives: when the
// shop moves to its own service, only the client's target changes.
type expenseShops struct {
	shops sellingv1connect.ShopServiceClient
}

func NewExpenseShops(shops sellingv1connect.ShopServiceClient) expense_v1.Shops {
	return &expenseShops{shops: shops}
}

// ShopOfTeam — ShopAccessCheck answers NotFound for another team's shop and for one that does not exist, which is
// exactly the refusal an expense needs. A CLOSED shop it answers, with its status, and an expense still runs on it
// (a-closed-shop-refuses-only-new-selling), so the status is not read. Nor is the caller's access: who in the team may
// spend was decided by ExpenseCreate's own policy, and the decision adds no grant check.
func (e *expenseShops) ShopOfTeam(ctx context.Context, teamID, shopID uint64) (bool, error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return false, errors.New("no caller to ask the shop as")
	}

	_, err = e.shops.ShopAccessCheck(ctx, connect.NewRequest(&sellingv1.ShopAccessCheckRequest{
		TeamId: teamID,
		ShopId: shopID,
		UserId: identity.GetIdentityId(),
	}))
	if err != nil {
		if connect.CodeOf(err) == connect.CodeNotFound {
			return false, nil
		}

		return false, err
	}

	return true, nil
}
