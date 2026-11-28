package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductTagManageList is the admins' Kelola tag produk — ProductTagList's tags in its order, each with how many products
// carry it, every team's (what the delete's confirm says: "it comes off N products"). Root / the Administrator only:
// rename and delete are theirs (products-have-their-own-tag-list). The app's tag is listed with its app task, which the
// screen reads as *Dipasang aplikasi* — no rename, no delete.
func (s *Service) ProductTagManageList(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagManageListRequest],
) (*connect.Response[productv1.ProductTagManageListResponse], error) {
	tags, info, err := productTagList(s.db.WithContext(ctx), req.Msg.GetQ(), req.Msg.GetPage(), true)
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductTagManageListResponse{Tags: tags, PageInfo: info}), nil
}
