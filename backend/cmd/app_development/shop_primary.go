package main

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// NewShopClient is how other services ask the shop — ShopAccessCheck, over Connect, under the CALLER's
// own token (san_auth.ForwardBearer).
//
// ⚠ A CLIENT, not the handler in-process, and deliberately: the shop lives in selling_service, which
// calls settlement on every placed order, so settlement holding *selling_v1.Service would be a cycle in
// the Wire graph. When the shop moves to its own service (the-shop-gets-its-own-service), only this
// client's target changes.
func NewShopClient(cfg *Config, client *internalHTTPClient) sellingv1connect.ShopServiceClient {
	return sellingv1connect.NewShopServiceClient(
		client,
		cfg.InternalBaseURL,
		connect.WithInterceptors(san_auth.ForwardBearer()),
	)
}

// shopPrimary answers settlement's ShopPrimary — who an imported shop row counts for
// (#settlement-asks-the-shop-for-its-primary-cs).
type shopPrimary struct {
	shops sellingv1connect.ShopServiceClient
}

func NewShopPrimary(shops sellingv1connect.ShopServiceClient) settlement_v1.ShopPrimary {
	return &shopPrimary{shops: shops}
}

func (p *shopPrimary) PrimaryUser(ctx context.Context, teamID, shopID, askingUserID uint64) (uint64, error) {
	resp, err := p.shops.ShopAccessCheck(ctx, connect.NewRequest(&sellingv1.ShopAccessCheckRequest{
		TeamId: teamID,
		ShopId: shopID,
		UserId: askingUserID,
	}))
	if err != nil {
		return 0, err
	}

	return resp.Msg.GetPrimaryUserId(), nil
}
