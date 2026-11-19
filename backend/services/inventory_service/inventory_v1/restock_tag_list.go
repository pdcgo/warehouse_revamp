package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockTagList is THE APP-WIDE TAG LIST (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps) — every
// team's tags, the system's first, then by name — for the restock lists' Tag filter and the detail's add box. The scope
// says who asks; the list is the same for every team. A read: the admin team's monitor reads it too.
func (s *Service) RestockTagList(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockTagListRequest],
) (*connect.Response[inventoryv1.RestockTagListResponse], error) {
	page := req.Msg.GetPage()

	tags, total, err := tagList(s.db.WithContext(ctx), req.Msg.GetQ(), page, false)
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockTagListResponse{
		Tags:     tags,
		PageInfo: pageInfo(page, total),
	}), nil
}
