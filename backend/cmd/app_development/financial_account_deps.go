package main

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// financialAccountShops answers financial_account's ShopChecker — whether a shop is a live shop of the team —
// by asking the shop, ShopAccessCheck over Connect under the CALLER's token (NewShopClient forwards it). A
// client, not the handler in-process, for the reason NewShopClient gives: when the shop moves to its own
// service, only the client's target changes.
type financialAccountShops struct {
	shops sellingv1connect.ShopServiceClient
}

func NewFinancialAccountShopChecker(shops sellingv1connect.ShopServiceClient) financial_account_v1.ShopChecker {
	return &financialAccountShops{shops: shops}
}

// ShopOfTeam — ShopAccessCheck answers NotFound for another team's shop, which is exactly the refusal ShopSet needs.
// A DELETED (closed) shop it now answers, flagged, and leaves the verdict to the caller
// (a-closed-shop-refuses-only-new-selling); linking an account to a closed shop is refused here as before — a new
// link is not a payout still running — so this adapter answers it NotFound. Whether the CALLER has access to the shop
// is not the question here; the account's policy already decided they may move the team's money.
func (c *financialAccountShops) ShopOfTeam(ctx context.Context, teamID, shopID uint64) error {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return errors.New("no caller to ask the shop as")
	}

	resp, err := c.shops.ShopAccessCheck(ctx, connect.NewRequest(&sellingv1.ShopAccessCheckRequest{
		TeamId: teamID,
		ShopId: shopID,
		UserId: identity.GetIdentityId(),
	}))
	if err != nil {
		return err
	}

	if resp.Msg.GetShop().GetDeleted() {
		return connect.NewError(connect.CodeNotFound, errors.New("shop not found"))
	}

	return nil
}
