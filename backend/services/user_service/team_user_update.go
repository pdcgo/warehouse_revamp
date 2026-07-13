package user_service

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// TeamUserUpdate implements [userv1connect.UserServiceHandler].
//
// Add or remove a team membership. The canonical SCOPED write: the interceptor has already
// proven the caller holds an admin/owner role IN team_id, so this handler contains no
// authorization logic at all.
//
// It is also the RPC team_service calls to grant a team's first owner (see
// team_service/team_create.go), which makes IDEMPOTENCY a requirement rather than a nicety: a
// retry after an ambiguous timeout must not double-grant or fail.
func (s *Service) TeamUserUpdate(
	ctx context.Context,
	req *connect.Request[userv1.TeamUserUpdateRequest],
) (*connect.Response[userv1.TeamUserUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()

	var affectedUser uint64

	switch action := req.Msg.GetAction().(type) {
	case *userv1.TeamUserUpdateRequest_Add:
		affectedUser = action.Add.GetUserId()

		err := s.addMember(ctx, teamID, action.Add)
		if err != nil {
			return nil, err
		}

	case *userv1.TeamUserUpdateRequest_Remove:
		affectedUser = action.Remove.GetUserId()

		err := s.removeMember(ctx, teamID, affectedUser)
		if err != nil {
			return nil, err
		}

	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("no action given"))
	}

	// INVALIDATE THE AFFECTED USER'S CACHED ROLES.
	//
	// The source evicted on login/logout but NOT here, so a granted or revoked role took up to
	// the cache TTL (a minute) to take effect. For a REVOKE that is a minute of continued
	// access after you thought you cut someone off.
	err := s.resolver.Invalidate(ctx, affectedUser)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.TeamUserUpdateResponse{}), nil
}

func (s *Service) addMember(ctx context.Context, teamID uint64, add *userv1.AddTeamUser) error {
	// The user must exist. There is no FK from user_team_roles to teams (that is another
	// service's table), but there IS one to users — this check turns the constraint violation
	// into a clear error.
	var count int64

	err := s.db.
		WithContext(ctx).
		Model(&user_service_models.User{}).
		Where("id = ?", add.GetUserId()).
		Count(&count).
		Error
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	if count == 0 {
		return connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}

	membership := user_service_models.UserTeamRole{
		TeamID: teamID,
		UserID: add.GetUserId(),
		Role:   int32(add.GetRole()),
		Alias:  add.GetAlias(),
	}

	// IDEMPOTENT UPSERT. ON CONFLICT is possible only because of the UNIQUE (team_id, user_id)
	// index — the same index the authorization read depends on.
	err = s.db.
		WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "team_id"}, {Name: "user_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"role":       membership.Role,
				"alias":      membership.Alias,
				"updated_at": gorm.Expr("NOW()"),
			}),
		}).
		Create(&membership).
		Error
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	return nil
}

func (s *Service) removeMember(ctx context.Context, teamID, userID uint64) error {
	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND user_id = ?", teamID, userID).
		Delete(&user_service_models.UserTeamRole{}).
		Error
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	// Removing a membership that is not there is a no-op, not an error — the caller's intent
	// ("this user is not in this team") is satisfied either way.
	return nil
}
