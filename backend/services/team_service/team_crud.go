package team_service

import (
	"context"
	"errors"
	"math"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

var errTeamMissing = errors.New("team not found")

func teamExists(tx *gorm.DB, teamID uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&team_service_models.Team{}).
		Where("id = ? AND deleted = ?", teamID, false).
		Count(&count).
		Error
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

// TeamUpdate implements [teamv1connect.TeamServiceHandler].
//
// Scoped: an owner may rename their OWN team (the interceptor enforced that already). `type` and
// `team_code` are immutable and are not in the request at all.
func (s *Service) TeamUpdate(
	ctx context.Context,
	req *connect.Request[teamv1.TeamUpdateRequest],
) (*connect.Response[teamv1.TeamUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()

	updates := map[string]any{}

	if req.Msg.Name != nil {
		updates["name"] = req.Msg.GetName()
	}

	if req.Msg.Description != nil {
		updates["description"] = req.Msg.GetDescription()
	}

	var team team_service_models.Team

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check existence FIRST, rather than inferring it from RowsAffected.
		//
		// Postgres reports 0 rows affected when an UPDATE writes identical values — so the
		// source's `RowsAffected == 0 => NotFound` returns a spurious NotFound whenever a user
		// re-submits an unchanged form.
		exists, err := teamExists(tx, teamID)
		if err != nil {
			return err
		}

		if !exists {
			return errTeamMissing
		}

		if len(updates) > 0 {
			err = tx.
				Model(&team_service_models.Team{}).
				Where("id = ?", teamID).
				Updates(withUpdatedAt(updates)).
				Error
			if err != nil {
				return err
			}
		}

		return tx.Where("id = ?", teamID).First(&team).Error
	})
	if err != nil {
		if errors.Is(err, errTeamMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&teamv1.TeamUpdateResponse{Team: teamToProto(&team)}), nil
}

// TeamDelete implements [teamv1connect.TeamServiceHandler]. Soft delete.
func (s *Service) TeamDelete(
	ctx context.Context,
	req *connect.Request[teamv1.TeamDeleteRequest],
) (*connect.Response[teamv1.TeamDeleteResponse], error) {
	teamID := req.Msg.GetTeamId()

	// The root team is the super-admin scope. Deleting it would strand every root/admin bypass
	// in the system — nothing in the source stops an admin doing exactly that with a stray click.
	if teamID == rootTeamID {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("the root team cannot be deleted"))
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := teamExists(tx, teamID)
		if err != nil {
			return err
		}

		if !exists {
			return errTeamMissing
		}

		return tx.
			Model(&team_service_models.Team{}).
			Where("id = ?", teamID).
			Updates(withUpdatedAt(map[string]any{"deleted": true})).
			Error
	})
	if err != nil {
		if errors.Is(err, errTeamMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&teamv1.TeamDeleteResponse{}), nil
}

// TeamDetail implements [teamv1connect.TeamServiceHandler].
//
// Filters `deleted` — unlike the source, where TeamDetail did NOT, so an id that TeamByIds
// omitted from its map was still fully readable here.
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

	// Bank details ride along on the DETAIL read only. TeamList and TeamByIds leave `info`
	// unset — they do not need it, and it keeps bulk harvesting off the table.
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

// escapeLike neutralises the LIKE wildcards. Not an injection fix (the value is bound), but
// without it a user searching for "%" matches everything, and "_" matches any character.
func escapeLike(q string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

	return replacer.Replace(q)
}

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

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
