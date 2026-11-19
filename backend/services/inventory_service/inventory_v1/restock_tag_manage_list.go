package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockTagManageList is the admins' Kelola tag list — RestockTagList's tags in its order, each with how many restocks
// carry it, every team's (what the delete's confirm says: "it comes off N restocks"). Root / the Administrator only:
// rename and delete are theirs (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps, its 🔄 line).
func (s *Service) RestockTagManageList(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockTagManageListRequest],
) (*connect.Response[inventoryv1.RestockTagManageListResponse], error) {
	page := req.Msg.GetPage()

	tags, total, err := tagList(s.db.WithContext(ctx), req.Msg.GetQ(), page, true)
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockTagManageListResponse{
		Tags:     tags,
		PageInfo: pageInfo(page, total),
	}), nil
}
