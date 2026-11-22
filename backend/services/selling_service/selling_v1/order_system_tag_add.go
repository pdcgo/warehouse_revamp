package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderSystemTagAdd puts an admin's SYSTEM tag on an order — Root / the Administrator only (the request's policy), naming
// either side of the order as team_id, in every status. A custom tag is InvalidArgument (it goes on with OrderTagAdd).
// Already on is no change.
func (s *Service) OrderSystemTagAdd(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderSystemTagAddRequest],
) (*connect.Response[sellingv1.OrderSystemTagAddResponse], error) {
	tags, err := s.setOrderTag(ctx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), req.Msg.GetTagId(), orderTagHandAdmin, true)
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderSystemTagAddResponse{Tags: tags}), nil
}
