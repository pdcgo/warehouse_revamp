package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderTagRemove takes a CUSTOM tag off an order — OrderTagAdd's sides, roles and statuses. Anyone who may tag takes it
// off, whoever put it on: an order's tags are ONE set for both sides. A SYSTEM tag is PermissionDenied. Not on is no
// change.
func (s *Service) OrderTagRemove(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderTagRemoveRequest],
) (*connect.Response[sellingv1.OrderTagRemoveResponse], error) {
	tags, err := s.setOrderTag(ctx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), req.Msg.GetTagId(), orderTagHandTeam, false)
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderTagRemoveResponse{Tags: tags}), nil
}
