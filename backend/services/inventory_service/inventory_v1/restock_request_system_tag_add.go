package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockRequestSystemTagAdd puts an admin's SYSTEM tag on a restock — Root / the Administrator only (the request's
// policy), naming either side of the restock as team_id, in every status. The app's own tags are FailedPrecondition
// (the app puts them on, a-restock-problem-is-a-system-tag); a custom tag is InvalidArgument (it goes on with
// RestockRequestTagAdd). Already on is no change.
func (s *Service) RestockRequestSystemTagAdd(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestSystemTagAddRequest],
) (*connect.Response[inventoryv1.RestockRequestSystemTagAddResponse], error) {
	tags, err := s.setRestockTag(ctx, req.Msg.GetTeamId(), req.Msg.GetRequestId(), req.Msg.GetTagId(), tagSideAdmin, true)
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestSystemTagAddResponse{Tags: tags}), nil
}
