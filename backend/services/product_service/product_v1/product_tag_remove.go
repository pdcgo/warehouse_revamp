package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductTagRemove takes a CUSTOM tag off a product — ProductTagAdd's team, roles and states; any writer takes it off,
// whoever put it on. A SYSTEM tag is PermissionDenied. Not on is no change.
func (s *Service) ProductTagRemove(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagRemoveRequest],
) (*connect.Response[productv1.ProductTagRemoveResponse], error) {
	tags, err := s.setProductTag(ctx, req.Msg.GetTeamId(), req.Msg.GetProductId(), req.Msg.GetTagId(), productTagHandTeam, false)
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductTagRemoveResponse{Tags: tags}), nil
}
