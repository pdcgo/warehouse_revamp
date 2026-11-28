package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductTagAdd puts a CUSTOM tag on a product — its writers (ProductUpdate's roles) in the team that owns it, archived or
// not (products-have-their-own-tag-list, the order tags' "every status"). Another team's product is NotFound; a SYSTEM
// tag is PermissionDenied — an admin puts one on with ProductSystemTagAdd, and the app's own is nobody's to move. Already
// on is no change. Nothing else of the product moves.
func (s *Service) ProductTagAdd(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagAddRequest],
) (*connect.Response[productv1.ProductTagAddResponse], error) {
	tags, err := s.setProductTag(ctx, req.Msg.GetTeamId(), req.Msg.GetProductId(), req.Msg.GetTagId(), productTagHandTeam, true)
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductTagAddResponse{Tags: tags}), nil
}
