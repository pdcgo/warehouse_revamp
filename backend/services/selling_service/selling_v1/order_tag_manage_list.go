package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderTagManageList is the admins' Kelola tag pesanan — OrderTagList's tags in its order, each with how many orders
// carry it, every team's (what the delete's confirm says: "it comes off N orders"). Root / the Administrator only: rename
// and delete are theirs (orders-have-their-own-tag-list, its 🔄 "A").
func (s *Service) OrderTagManageList(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderTagManageListRequest],
) (*connect.Response[sellingv1.OrderTagManageListResponse], error) {
	tags, info, err := orderTagList(s.db.WithContext(ctx), req.Msg.GetQ(), req.Msg.GetPage(), true)
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderTagManageListResponse{Tags: tags, PageInfo: info}), nil
}
