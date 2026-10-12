package team_v1

import (
	"context"
	"errors"
	"fmt"
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
// The team row and its first Owner's role live in two different services' databases, so this cannot
// be one transaction. It is a saga:
//
//  1. commit the team (+ its info row) locally;
//  2. grant the person the form NAMED (owner_user_id) the team type's Owner role via user_service,
//     forwarding the caller's own bearer. The caller is NOT made a member
//     (the-create-team-form-names-the-first-owner): Root and the Administrator reach every team;
//  3. if the grant fails, COMPENSATE — see undoTeam for which way.
//
// Blocking is fine here: only ROOT/ADMIN may create a team, it happens rarely, and the exposure
// window is one RPC round-trip. The worst case is benign — root/admin bypass every scope check,
// so even a failed compensation leaves a team that an admin can fix by hand, not a bricked one.
func (s *Service) TeamCreate(
	ctx context.Context,
	req *connect.Request[teamv1.TeamCreateRequest],
) (*connect.Response[teamv1.TeamCreateResponse], error) {
	// The pure-DB core, separated so it can be unit-tested without the saga below.
	team, err := s.createTeam(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	// --- the saga's remote step ---
	err = s.grantOwner(ctx, team.ID, req.Msg.GetOwnerUserId(), req.Msg.GetType())
	if err != nil {
		return nil, s.undoTeam(ctx, team.ID, err)
	}

	return connect.NewResponse(&teamv1.TeamCreateResponse{Team: teamToProto(team)}), nil
}

// undoTeam compensates a failed grant, and HOW depends on whether the grant can have happened.
//
//   - REFUSED (grantRefused): user_service turned it down before writing anything — an unknown or
//     suspended person, a role it would not give. Nothing points at the team, so it is HARD-deleted
//     and its code is free again. ⚠ team_code is unique across deleted teams too, so a soft delete
//     here would burn the code: the next Create with it would be told the code is taken, by a team
//     nobody can see.
//   - UNKNOWN (a timeout, an outage, an Internal): the grant may in fact have SUCCEEDED. A hard delete
//     would leave a user_team_roles row pointing at a team that no longer exists, so it is
//     SOFT-deleted, and the code stays taken.
func (s *Service) undoTeam(ctx context.Context, teamID uint64, grantErr error) error {
	if grantRefused(grantErr) {
		// team_infos cascades.
		deleteErr := s.db.
			WithContext(ctx).
			Where("id = ?", teamID).
			Delete(&team_service_models.Team{}).
			Error
		if deleteErr != nil {
			slog.Error("owner refused, and the team could not be removed",
				slog.Uint64("team_id", teamID),
				slog.String("grant_err", grantErr.Error()),
				slog.String("delete_err", deleteErr.Error()),
			)
		}

		return connect.NewError(connect.CodeOf(grantErr),
			fmt.Errorf("the team was not created — its Owner was refused: %s", connectMessage(grantErr)))
	}

	// Soft-delete, never hard-delete: see above.
	compensateErr := s.db.
		WithContext(ctx).
		Model(&team_service_models.Team{}).
		Where("id = ?", teamID).
		Update("deleted", true).
		Error
	if compensateErr != nil {
		// Both the grant AND the rollback failed. Say so loudly — this is the one state a
		// human has to look at.
		slog.Error("team created but ownerless, and compensation failed",
			slog.Uint64("team_id", teamID),
			slog.String("grant_err", grantErr.Error()),
			slog.String("compensate_err", compensateErr.Error()),
		)
	}

	return connect.NewError(connect.CodeInternal,
		errors.New("team created but the owner grant failed; the team was rolled back"))
}

// grantRefused reports a grant user_service DECLINED, as opposed to one whose outcome is unknown.
//
// Each of these codes is returned before user_service writes — by the access interceptor, request
// validation, or TeamUserUpdate's checks inside the transaction that then rolls back. Anything else
// (Internal, Unavailable, DeadlineExceeded, Canceled, Unknown) may have come after a commit: the role
// cache eviction runs after it and reports Internal.
func grantRefused(err error) bool {
	switch connect.CodeOf(err) {
	case connect.CodeInvalidArgument,
		connect.CodeNotFound,
		connect.CodePermissionDenied,
		connect.CodeUnauthenticated,
		connect.CodeFailedPrecondition:
		return true
	default:
		return false
	}
}

// connectMessage is the error's own message, without connect's "code: " prefix — the caller gets the
// code separately.
func connectMessage(err error) string {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr.Message()
	}

	return err.Error()
}

// createTeam validates the request and inserts the team + its (empty) info row in one
// transaction. It is the pure-DB core of TeamCreate, kept separate from the owner-grant saga so
// it can be unit-tested without a live user_service. Returns connect errors ready to surface.
func (s *Service) createTeam(ctx context.Context, msg *teamv1.TeamCreateRequest) (*team_service_models.Team, error) {
	teamType := msg.GetType()

	typeText, err := teamTypeToText(teamType)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// The CHECK constraint would catch this, but a clear error beats a constraint violation.
	if teamType == teamv1.TeamType_TEAM_TYPE_ROOT {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("the root team is seeded, it cannot be created"))
	}

	team := &team_service_models.Team{
		Type:        typeText,
		Name:        msg.GetName(),
		TeamCode:    msg.GetTeamCode(),
		Description: msg.GetDescription(),
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Create(team).Error
		if err != nil {
			return err
		}

		return tx.Create(&team_service_models.TeamInfo{TeamID: team.ID}).Error
	})
	if err != nil {
		return nil, dbError(err)
	}

	return team, nil
}

// grantOwner asks user_service to make userID this team's Owner.
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
