package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductSystemTagAdd puts an admin's SYSTEM tag on a product — Root / the Administrator only (the request's policy),
// naming the product's owning team as team_id. A custom tag is InvalidArgument (it goes on with ProductTagAdd); the app's
// own (`need_reprint_code`) is FailedPrecondition — locked, admins included. Already on is no change.
func (s *Service) ProductSystemTagAdd(
	ctx context.Context,
	req *connect.Request[productv1.ProductSystemTagAddRequest],
) (*connect.Response[productv1.ProductSystemTagAddResponse], error) {
	tags, err := s.setProductTag(ctx, req.Msg.GetTeamId(), req.Msg.GetProductId(), req.Msg.GetTagId(), productTagHandAdmin, true)
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductSystemTagAddResponse{Tags: tags}), nil
}
