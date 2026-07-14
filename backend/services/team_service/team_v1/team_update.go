package team_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

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
		// Postgres reports 0 rows affected when an UPDATE writes identical values — so a naive
		// `RowsAffected == 0 => NotFound` returns a spurious NotFound whenever a user re-submits
		// an unchanged form.
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
