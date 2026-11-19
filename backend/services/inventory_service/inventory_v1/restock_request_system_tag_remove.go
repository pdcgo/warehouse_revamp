package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockRequestSystemTagRemove takes an admin's SYSTEM tag off a restock — RestockRequestSystemTagAdd's mirror. The
// app's own tags stay: when a problem tag comes off waits on the problem's solution (a-restock-problem-is-a-system-tag).
func (s *Service) RestockRequestSystemTagRemove(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestSystemTagRemoveRequest],
) (*connect.Response[inventoryv1.RestockRequestSystemTagRemoveResponse], error) {
	tags, err := s.setRestockTag(ctx, req.Msg.GetTeamId(), req.Msg.GetRequestId(), req.Msg.GetTagId(), tagSideAdmin, false)
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestSystemTagRemoveResponse{Tags: tags}), nil
}
