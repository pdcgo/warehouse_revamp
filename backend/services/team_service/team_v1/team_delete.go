package team_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// TeamDelete implements [teamv1connect.TeamServiceHandler]. Soft delete.
func (s *Service) TeamDelete(
	ctx context.Context,
	req *connect.Request[teamv1.TeamDeleteRequest],
) (*connect.Response[teamv1.TeamDeleteResponse], error) {
	teamID := req.Msg.GetTeamId()

	// The root team is the super-admin scope. Deleting it would strand every root/admin bypass
	// in the system — nothing else stops an admin doing exactly that with a stray click.
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
