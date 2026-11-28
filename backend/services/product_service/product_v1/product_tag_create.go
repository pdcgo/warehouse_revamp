package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductTagCreate makes a CUSTOM product tag — anyone who may write on a product (ProductUpdate's roles; a monitor
// reaches reads only). ONE NAME, ONE TAG: a name already on the products' list, any case and spaces folded, answers that
// tag — whatever its type, the app's included — and never makes a twin (createProductTag). An order or restock tag's name
// is free here (products-have-their-own-tag-list).
func (s *Service) ProductTagCreate(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagCreateRequest],
) (*connect.Response[productv1.ProductTagCreateResponse], error) {
	tag, created, err := s.createProductTag(ctx, req.Msg.GetName(), productTagCustom)
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductTagCreateResponse{Tag: tag, Created: created}), nil
}
