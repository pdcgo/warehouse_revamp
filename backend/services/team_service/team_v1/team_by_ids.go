package team_v1

import (
	"context"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// TeamByIds implements [teamv1connect.TeamServiceHandler].
//
// THE ANTI-JOIN PRIMITIVE. This is how every other service turns a team_id it stores locally
// into a name and a type without touching this service's database. Per-service independence
// forbids a cross-service SQL join; this replaces it.
//
// Unknown and soft-deleted ids are OMITTED from the map — no error, no placeholder. Callers must
// check for presence. That omission is deliberate and load-bearing: it is what stops a deleted
// team from lingering forever in every user's team list (which is precisely what the source's
// unfiltered JOIN did).
func (s *Service) TeamByIds(
	ctx context.Context,
	req *connect.Request[teamv1.TeamByIdsRequest],
) (*connect.Response[teamv1.TeamByIdsResponse], error) {
	var teams []team_service_models.Team

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetIds()).
		Where("deleted = ?", false).
		Find(&teams).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	// Never nil: ranging an empty result must be safe for every caller.
	data := make(map[uint64]*teamv1.Team, len(teams))

	for i := range teams {
		data[teams[i].ID] = teamToProto(&teams[i])
	}

	return connect.NewResponse(&teamv1.TeamByIdsResponse{Data: data}), nil
}
