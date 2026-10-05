package user_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// SuspendUser implements [userv1connect.UserServiceHandler].
//
// Account-wide, by Root or the Administrator only, and never sideways
// (only-root-and-the-administrator-suspend): no Root is suspended, an Administrator only by Root, and
// nobody suspends themselves. The target is judged by its ROOT-TEAM ROLE, never its id — a second Root
// is as protected as user 1.
//
// Suspension takes effect on the NEXT REQUEST, not at the next login: the access interceptor
// reads it on every call, and invalidating the cache here makes it immediate. Without that, a
// suspended user would keep working until their token expired.
func (s *Service) SuspendUser(
	ctx context.Context,
	req *connect.Request[userv1.SuspendUserRequest],
) (*connect.Response[userv1.SuspendUserResponse], error) {
	userID := req.Msg.GetUserId()

	caller, err := s.callerIn(ctx, san_auth.RootTeamID)
	if err != nil {
		return nil, err
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The same lock as a membership write, so the target cannot be made an Administrator (or a
		// Root, through san) between the role read and the suspend.
		targetRoot, err := lockMembership(tx, userID, san_auth.RootTeamID)
		if err != nil {
			return err
		}

		err = checkSuspend(caller, userID, targetRoot)
		if err != nil {
			return err
		}

		err = tx.
			Model(&user_service_models.User{}).
			Where("id = ?", userID).
			Updates(map[string]any{
				"is_suspended": req.Msg.GetSuspended(),
				"updated_at":   gorm.Expr("NOW()"),
			}).
			Error
		if err != nil {
			return connect.NewError(connect.CodeInternal, err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Make it bite NOW. The cached access decision says "not suspended".
	err = s.resolver.Invalidate(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.SuspendUserResponse{}), nil
}
