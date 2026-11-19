package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockRequestTagRemove takes a CUSTOM tag off a restock — RestockRequestTagAdd's sides, roles and statuses. Anyone who
// may tag takes it off, whoever put it on: a restock's tags are ONE set for both sides. A SYSTEM tag is PermissionDenied.
// Not on is no change.
func (s *Service) RestockRequestTagRemove(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestTagRemoveRequest],
) (*connect.Response[inventoryv1.RestockRequestTagRemoveResponse], error) {
	tags, err := s.setRestockTag(ctx, req.Msg.GetTeamId(), req.Msg.GetRequestId(), req.Msg.GetTagId(), tagSideTeam, false)
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestTagRemoveResponse{Tags: tags}), nil
}
