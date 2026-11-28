package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductSystemTagRemove takes an admin's SYSTEM tag off a product — ProductSystemTagAdd's mirror (the app's own is
// FailedPrecondition). Not on is no change.
func (s *Service) ProductSystemTagRemove(
	ctx context.Context,
	req *connect.Request[productv1.ProductSystemTagRemoveRequest],
) (*connect.Response[productv1.ProductSystemTagRemoveResponse], error) {
	tags, err := s.setProductTag(ctx, req.Msg.GetTeamId(), req.Msg.GetProductId(), req.Msg.GetTagId(), productTagHandAdmin, false)
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductSystemTagRemoveResponse{Tags: tags}), nil
}
