package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// ShopAccessCheck answers, in one call, the shop, its primary CS, and whether a user may WRITE on it
// (one-call-answers-the-shop-and-the-access). The answer is shopAccess — the same one this service's own order writes
// ask in-process (refuseShopWrite, shop_write_gate.go).
//
// The settlement importer asks it before storing a file (the-shop-is-checked-before-the-file-is-stored),
// and settlement asks it for an imported shop row's primary CS (settlement-asks-the-shop-for-its-primary-cs).
//
// A CLOSED SHOP IS ANSWERED, with its `status` (a-closed-shop-refuses-only-new-selling): a closed shop's last
// statements still import and its rows still find their primary CS. Each caller decides what a closed shop may do;
// another team's shop, or one that never existed, is NotFound.
func (s *Service) ShopAccessCheck(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopAccessCheckRequest],
) (*connect.Response[sellingv1.ShopAccessCheckResponse], error) {
	shop, access, err := s.shopAccess(ctx, req.Msg.GetTeamId(), req.Msg.GetShopId(), req.Msg.GetUserId())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.ShopAccessCheckResponse{
		Shop:          toProto(shop),
		PrimaryUserId: shop.PrimaryUserID,
		IsHaveAccess:  access,
	}), nil
}
