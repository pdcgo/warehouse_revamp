package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// DeleteUser implements [userv1connect.UserServiceHandler]. Hard delete; memberships cascade.
func (s *Service) DeleteUser(
	ctx context.Context,
	req *connect.Request[userv1.DeleteUserRequest],
) (*connect.Response[userv1.DeleteUserResponse], error) {
	userID := req.Msg.GetUserId()

	if userID == rootUserID {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("the root account cannot be deleted"))
	}

	result := s.db.
		WithContext(ctx).
		Where("id = ?", userID).
		Delete(&user_service_models.User{})
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, result.Error)
	}

	if result.RowsAffected == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errUserMissing)
	}

	// The FK on user_team_roles is ON DELETE CASCADE, so the memberships are already gone. The
	// CACHE is not — and a cached role for a deleted user would keep authorizing requests until
	// it expired.
	err := s.resolver.Invalidate(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.DeleteUserResponse{}), nil
}
