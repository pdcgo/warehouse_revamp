package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderSystemTagRemove takes an admin's SYSTEM tag off an order — OrderSystemTagAdd's mirror.
func (s *Service) OrderSystemTagRemove(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderSystemTagRemoveRequest],
) (*connect.Response[sellingv1.OrderSystemTagRemoveResponse], error) {
	tags, err := s.setOrderTag(ctx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), req.Msg.GetTagId(), orderTagHandAdmin, false)
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderSystemTagRemoveResponse{Tags: tags}), nil
}
