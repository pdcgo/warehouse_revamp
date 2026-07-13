package team_service

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// TeamCreate implements [teamv1connect.TeamServiceHandler].
//
// The team row and the creator's OWNER role live in two different services' databases, so this
// cannot be one transaction. It is a saga:
//
//  1. commit the team (+ its info row) locally;
//  2. grant the creator the owner role via user_service, forwarding the caller's own bearer;
//  3. if the grant fails, COMPENSATE by soft-deleting the team.
//
// Blocking is fine here: only ROOT/ADMIN may create a team, it happens rarely, and the exposure
// window is one RPC round-trip. The worst case is benign — root/admin bypass every scope check,
// so even a failed compensation leaves a team that an admin can fix by hand, not a bricked one.
func (s *Service) TeamCreate(
	ctx context.Context,
	req *connect.Request[teamv1.TeamCreateRequest],
) (*connect.Response[teamv1.TeamCreateResponse], error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	teamType := req.Msg.GetType()

	typeText, err := teamTypeToText(teamType)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// The CHECK constraint would catch this, but a clear error beats a constraint violation.
	if teamType == teamv1.TeamType_TEAM_TYPE_ROOT {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("the root team is seeded, it cannot be created"))
	}

	team := team_service_models.Team{
		Type:        typeText,
		Name:        req.Msg.GetName(),
		TeamCode:    req.Msg.GetTeamCode(),
		Description: req.Msg.GetDescription(),
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Create(&team).Error
		if err != nil {
			return err
		}

		return tx.Create(&team_service_models.TeamInfo{TeamID: team.ID}).Error
	})
	if err != nil {
		return nil, dbError(err)
	}

	// --- the saga's remote step ---
	err = s.grantOwner(ctx, team.ID, identity.GetIdentityId(), teamType)
	if err != nil {
		// COMPENSATE. Soft-delete, never hard-delete: the grant may in fact have SUCCEEDED on a
		// call that timed out, and a hard delete would leave a dangling user_team_roles row
		// pointing at a team that no longer exists.
		compensateErr := s.db.
			WithContext(ctx).
			Model(&team_service_models.Team{}).
			Where("id = ?", team.ID).
			Update("deleted", true).
			Error
		if compensateErr != nil {
			// Both the grant AND the rollback failed. Say so loudly — this is the one state a
			// human has to look at.
			slog.Error("team created but ownerless, and compensation failed",
				slog.Uint64("team_id", team.ID),
				slog.String("grant_err", err.Error()),
				slog.String("compensate_err", compensateErr.Error()),
			)
		}

		return nil, connect.NewError(connect.CodeInternal,
			errors.New("team created but the owner grant failed; the team was rolled back"))
	}

	return connect.NewResponse(&teamv1.TeamCreateResponse{Team: teamToProto(&team)}), nil
}

// grantOwner asks user_service to make the caller this team's owner.
//
// The caller's OWN bearer is forwarded, not a service credential: user_service then applies the
// caller's permissions, not ours. A service calling another with its own privileges is a
// confused deputy.
func (s *Service) grantOwner(ctx context.Context, teamID, userID uint64, teamType teamv1.TeamType) error {
	grant := connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: teamID,
		Action: &userv1.TeamUserUpdateRequest_Add{
			Add: &userv1.AddTeamUser{
				UserId: userID,
				Role:   role_basev1.Role(ownerRoleFor(teamType)),
				Alias:  "owner",
			},
		},
	})

	token := san_auth.GetBearer(ctx)
	if token != "" {
		grant.Header().Set("Authorization", "Bearer "+token)
	}

	_, err := s.userClient.TeamUserUpdate(ctx, grant)

	return err
}
