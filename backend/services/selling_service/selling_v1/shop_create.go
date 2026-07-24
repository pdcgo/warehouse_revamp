package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopCreate adds a shop to the scoped selling team.
func (s *Service) ShopCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopCreateRequest],
) (*connect.Response[sellingv1.ShopCreateResponse], error) {
	shop := &selling_service_models.Shop{
		TeamID:      req.Msg.GetTeamId(),
		Name:        req.Msg.GetName(),
		ShopCode:    req.Msg.GetShopCode(),
		Marketplace: san_marketplace.ToText(req.Msg.GetMarketplace()),
		Description: req.Msg.GetDescription(),
	}

	err := s.db.WithContext(ctx).Create(shop).Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.ShopCreateResponse{Shop: toProto(shop)}), nil
}
