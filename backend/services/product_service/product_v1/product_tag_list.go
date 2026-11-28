package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductTagList is THE PRODUCTS' TAG LIST (products-have-their-own-tag-list) — every team's product tags, the system's
// first (the app's `need_reprint_code` among them), then by name — for both Products lists' Tag filter and the product
// page's add box. The orders' and the restocks' tags are other lists and never appear here. The scope says who asks; the
// list is the same for every team, a warehouse's included (its list filters by tag too). A read: the admin team's
// monitor reads it too.
func (s *Service) ProductTagList(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagListRequest],
) (*connect.Response[productv1.ProductTagListResponse], error) {
	tags, info, err := productTagList(s.db.WithContext(ctx), req.Msg.GetQ(), req.Msg.GetPage(), false)
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductTagListResponse{Tags: tags, PageInfo: info}), nil
}
