package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockRequestTagAdd puts a CUSTOM tag on a restock — either side that sees it (its selling team, its receiving
// warehouse), every role but a monitor, in EVERY status (the owner's 🔄 under the-restock-tags-prototype-is-accepted, as
// the-note-is-edited-in-any-status). Another team's restock is NotFound; a SYSTEM tag is PermissionDenied — an admin
// puts one on with RestockRequestSystemTagAdd, and the app's own by the app alone. Already on is no change. Nothing else
// of the restock moves: no trail row, no event.
func (s *Service) RestockRequestTagAdd(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestTagAddRequest],
) (*connect.Response[inventoryv1.RestockRequestTagAddResponse], error) {
	tags, err := s.setRestockTag(ctx, req.Msg.GetTeamId(), req.Msg.GetRequestId(), req.Msg.GetTagId(), tagSideTeam, true)
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestTagAddResponse{Tags: tags}), nil
}
