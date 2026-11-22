package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderTagAdd puts a CUSTOM tag on an order — either side that writes on it (its selling team, the warehouse that ships
// it), every role but a monitor, in EVERY status (orders-have-their-own-tag-list, its 🔄 "A"). Another team's order is
// NotFound; a SYSTEM tag is PermissionDenied — an admin puts one on with OrderSystemTagAdd. Already on is no change.
// Nothing else of the order moves: no timeline row, no event.
func (s *Service) OrderTagAdd(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderTagAddRequest],
) (*connect.Response[sellingv1.OrderTagAddResponse], error) {
	tags, err := s.setOrderTag(ctx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), req.Msg.GetTagId(), orderTagHandTeam, true)
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderTagAddResponse{Tags: tags}), nil
}
