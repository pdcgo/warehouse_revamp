package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderTagList is THE ORDERS' TAG LIST (orders-have-their-own-tag-list) — every team's order tags, the system's first,
// then by name — for the order lists' Tag filter and the order pages' add box. The restocks' tags are another list and
// never appear here. The scope says who asks; the list is the same for every team. A read: the admin team's monitor
// reads it too.
func (s *Service) OrderTagList(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderTagListRequest],
) (*connect.Response[sellingv1.OrderTagListResponse], error) {
	tags, info, err := orderTagList(s.db.WithContext(ctx), req.Msg.GetQ(), req.Msg.GetPage(), false)
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderTagListResponse{Tags: tags, PageInfo: info}), nil
}
