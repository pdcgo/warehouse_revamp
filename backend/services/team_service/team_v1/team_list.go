package team_v1

import (
	"context"
	"math"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// TeamList implements [teamv1connect.TeamServiceHandler].
func (s *Service) TeamList(
	ctx context.Context,
	req *connect.Request[teamv1.TeamListRequest],
) (*connect.Response[teamv1.TeamListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&team_service_models.Team{}).
		Where("deleted = ?", false)

	if q := strings.TrimSpace(req.Msg.GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("name ILIKE ? OR team_code ILIKE ?", pattern, pattern)
	}

	if teamType := req.Msg.GetTeamType(); teamType != teamv1.TeamType_TEAM_TYPE_UNSPECIFIED {
		text, err := teamTypeToText(teamType)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}

		query = query.Where("type = ?", text)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var teams []team_service_models.Team

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&teams).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*teamv1.Team, 0, len(teams))
	for i := range teams {
		out = append(out, teamToProto(&teams[i]))
	}

	return connect.NewResponse(&teamv1.TeamListResponse{
		Teams: out,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

// escapeLike neutralises the LIKE wildcards. Not an injection fix (the value is bound), but
// without it a search for "%" matches everything and "_" matches any character.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
