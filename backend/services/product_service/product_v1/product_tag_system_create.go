package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductTagSystemCreate makes a SYSTEM product tag — Root / the Administrator only (the request's policy). The same
// one-name-one-tag answer as ProductTagCreate; it carries no app task (only a migration seeds an app's tag).
func (s *Service) ProductTagSystemCreate(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagSystemCreateRequest],
) (*connect.Response[productv1.ProductTagSystemCreateResponse], error) {
	tag, created, err := s.createProductTag(ctx, req.Msg.GetName(), productTagSystem)
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductTagSystemCreateResponse{Tag: tag, Created: created}), nil
}
