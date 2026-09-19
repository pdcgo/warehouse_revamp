package team_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// TeamDetail implements [teamv1connect.TeamServiceHandler].
//
// Filters `deleted` — so an id that TeamByIds omits from its map is not still fully readable
// here. Bank details ride along on the DETAIL read only.
func (s *Service) TeamDetail(
	ctx context.Context,
	req *connect.Request[teamv1.TeamDetailRequest],
) (*connect.Response[teamv1.TeamDetailResponse], error) {
	var team team_service_models.Team

	err := s.db.
		WithContext(ctx).
		Where("id = ? AND deleted = ?", req.Msg.GetTeamId(), false).
		First(&team).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	out := teamToProto(&team)

	// TeamList and TeamByIds leave `info` unset — they do not need it, and it keeps bulk
	// harvesting off the table.
	var info team_service_models.TeamInfo

	err = s.db.
		WithContext(ctx).
		Where("team_id = ?", team.ID).
		First(&info).
		Error
	if err == nil {
		out.Info = teamInfoToProto(&info)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, dbError(err)
	}

	return connect.NewResponse(&teamv1.TeamDetailResponse{Team: out}), nil
}
