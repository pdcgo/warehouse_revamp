package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// GrantRoot and RevokeRoot are how a Root is added and removed (root-can-be-several) — tools/san's, and NEVER an RPC
// (root-is-granted-only-through-san): no request message names them, so no caller of the API can reach them, and
// TeamUserUpdate refuses to give or take Root. They are domain methods called in-process, like liability's PostEntry.
//
// Both run under the same lock as every membership write — the person's users row (lockMembership) — and write the
// membership-log row with `agent` as the actor (every-role-change-is-logged).

// GrantRoot makes the person a Root. Already a Root is a no-op (changed = false). A System Administrator becomes Root —
// one role per team. A suspended or erased account is refused: it is never newly given anything
// (a-suspended-user-is-never-picked).
func (s *Service) GrantRoot(ctx context.Context, userID uint64, agent string) (bool, error) {
	if agent == "" {
		return false, errors.New("GrantRoot: name the agent acting — it is the log row's actor")
	}

	changed := false

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockMembership(tx, userID, san_auth.RootTeamID)
		if err != nil {
			return err
		}

		if locked.role == role_basev1.Role_ROLE_ROOT {
			return nil
		}

		if locked.erased || locked.suspended {
			return connect.NewError(connect.CodeFailedPrecondition,
				errors.New("a suspended or erased account is never made Root (a-suspended-user-is-never-picked)"))
		}

		err = tx.
			Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "team_id"}, {Name: "user_id"}},
				DoUpdates: clause.Assignments(map[string]any{
					"role":       int32(role_basev1.Role_ROLE_ROOT),
					"updated_at": gorm.Expr("NOW()"),
				}),
			}).
			Create(&user_service_models.UserTeamRole{
				TeamID: san_auth.RootTeamID,
				UserID: userID,
				Role:   int32(role_basev1.Role_ROLE_ROOT),
			}).
			Error
		if err != nil {
			return connect.NewError(connect.CodeInternal, err)
		}

		_, err = logMembership(tx, callerReach{agent: agent}, san_auth.RootTeamID, userID, locked.role, role_basev1.Role_ROLE_ROOT)
		if err != nil {
			return err
		}

		changed = true

		return nil
	})
	if err != nil {
		return false, err
	}

	_ = s.resolver.Invalidate(ctx, userID)

	return changed, nil
}

// RevokeRoot takes Root from the person: they leave the root team. Refused for somebody who is not a Root, and for the
// LAST Root (root-can-be-several, Q20c) — the system is never left with nobody who can do anything.
//
// "The last" is counted under a lock on EVERY Root's membership row, taken after the person's own users row. Two
// removals of the last two Roots at once therefore run one after the other, and the second counts one and is refused;
// counted without the lock, both would see two and leave none.
func (s *Service) RevokeRoot(ctx context.Context, userID uint64, agent string) error {
	if agent == "" {
		return errors.New("RevokeRoot: name the agent acting — it is the log row's actor")
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockMembership(tx, userID, san_auth.RootTeamID)
		if err != nil {
			return err
		}

		if locked.role != role_basev1.Role_ROLE_ROOT {
			return connect.NewError(connect.CodeFailedPrecondition, errors.New("this account is not a Root"))
		}

		var roots []uint64

		err = tx.
			Model(&user_service_models.UserTeamRole{}).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("team_id = ? AND role = ?", san_auth.RootTeamID, int32(role_basev1.Role_ROLE_ROOT)).
			Order("user_id").
			Pluck("user_id", &roots).
			Error
		if err != nil {
			return connect.NewError(connect.CodeInternal, err)
		}

		if len(roots) <= 1 {
			return connect.NewError(connect.CodeFailedPrecondition,
				errors.New("the last Root is never removed — add another first (root-can-be-several)"))
		}

		err = tx.
			Where("team_id = ? AND user_id = ?", san_auth.RootTeamID, userID).
			Delete(&user_service_models.UserTeamRole{}).
			Error
		if err != nil {
			return connect.NewError(connect.CodeInternal, err)
		}

		_, err = logMembership(tx, callerReach{agent: agent}, san_auth.RootTeamID, userID, role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_UNSPECIFIED)

		return err
	})
	if err != nil {
		return err
	}

	_ = s.resolver.Invalidate(ctx, userID)

	return nil
}
