package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// TeamUserUpdate implements [userv1connect.UserServiceHandler].
//
// Add, change or remove a team membership. The interceptor has proven the caller may manage this
// team's members at all; checkMemberWrite decides what they may do to THIS person — never Root, the
// Administrator only by Root, and otherwise only below the caller's own role
// (change-role-only-below-your-own, an-owner-never-makes-another-owner, no-admin-makes-another-admin).
//
// It is also the RPC team_service calls to grant a team's first owner (see
// team_service/team_create.go), which makes IDEMPOTENCY a requirement rather than a nicety: a
// retry after an ambiguous timeout must not double-grant or fail.
func (s *Service) TeamUserUpdate(
	ctx context.Context,
	req *connect.Request[userv1.TeamUserUpdateRequest],
) (*connect.Response[userv1.TeamUserUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()

	caller, err := s.callerIn(ctx, teamID)
	if err != nil {
		return nil, err
	}

	var affectedUser uint64

	switch action := req.Msg.GetAction().(type) {
	case *userv1.TeamUserUpdateRequest_Add:
		affectedUser = action.Add.GetUserId()

		err = s.addMember(ctx, caller, teamID, action.Add)
		if err != nil {
			return nil, err
		}

	case *userv1.TeamUserUpdateRequest_Remove:
		affectedUser = action.Remove.GetUserId()

		err = s.removeMember(ctx, caller, teamID, affectedUser)
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
	err = s.resolver.Invalidate(ctx, affectedUser)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.TeamUserUpdateResponse{}), nil
}

func (s *Service) addMember(ctx context.Context, caller callerReach, teamID uint64, add *userv1.AddTeamUser) error {
	teamType, err := s.teamTypeOf(ctx, teamID)
	if err != nil {
		return err
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockMembership(tx, add.GetUserId(), teamID)
		if err != nil {
			return err
		}

		current := locked.role

		err = checkMemberWrite(caller, memberWrite{
			teamType: teamType,
			target:   add.GetUserId(),
			current:  current,
			next:     add.GetRole(),
		})
		if err != nil {
			return err
		}

		err = refuseSuspendedNewcomer(locked)
		if err != nil {
			return err
		}

		membership := user_service_models.UserTeamRole{
			TeamID: teamID,
			UserID: add.GetUserId(),
			Role:   int32(add.GetRole()),
			Alias:  add.GetAlias(),
		}

		// IDEMPOTENT UPSERT. ON CONFLICT is possible only because of the UNIQUE (team_id, user_id)
		// index — the same index the authorization read depends on.
		err = tx.
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

		return logMembership(tx, caller, teamID, add.GetUserId(), current, add.GetRole())
	})
}

func (s *Service) removeMember(ctx context.Context, caller callerReach, teamID, userID uint64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockMembership(tx, userID, teamID)
		if err != nil {
			return err
		}

		current := locked.role

		// Removing a membership that is not there is a no-op, not an error — the caller's intent
		// ("this user is not in this team") is satisfied either way.
		if current == role_basev1.Role_ROLE_UNSPECIFIED {
			return nil
		}

		// Removing is giving no role: the same people, the same limits
		// (removing-a-member-drops-their-shop-access).
		err = checkMemberWrite(caller, memberWrite{
			target:  userID,
			current: current,
			next:    role_basev1.Role_ROLE_UNSPECIFIED,
		})
		if err != nil {
			return err
		}

		err = tx.
			Where("team_id = ? AND user_id = ?", teamID, userID).
			Delete(&user_service_models.UserTeamRole{}).
			Error
		if err != nil {
			return connect.NewError(connect.CodeInternal, err)
		}

		return logMembership(tx, caller, teamID, userID, current, role_basev1.Role_ROLE_UNSPECIFIED)
	})
}
