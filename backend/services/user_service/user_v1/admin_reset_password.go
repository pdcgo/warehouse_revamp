package user_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// AdminResetPassword implements [userv1connect.UserServiceHandler] — root/admin sets ANOTHER
// user's password.
//
// A DIFFERENT OPERATION WITH A DIFFERENT POLICY. It takes a user_id (that is the whole point)
// and requires no old password (an admin does not know it). Conflating this with the self-serve
// reset — one RPC meaning both, gated as if it meant only the first — is exactly the source's
// bug.
func (s *Service) AdminResetPassword(
	ctx context.Context,
	req *connect.Request[userv1.AdminResetPasswordRequest],
) (*connect.Response[userv1.AdminResetPasswordResponse], error) {
	var user user_service_models.User

	err := s.db.
		WithContext(ctx).
		Where("id = ?", req.Msg.GetUserId()).
		First(&user).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	_, err = s.setPassword(ctx, &user, req.Msg.GetNewPassword(), time.Now())
	if err != nil {
		return nil, err
	}

	// No token is returned: the admin is not the subject. The TARGET user's existing tokens are
	// now dead, which is the desired outcome when an admin resets a compromised account.
	return connect.NewResponse(&userv1.AdminResetPasswordResponse{}), nil
}
