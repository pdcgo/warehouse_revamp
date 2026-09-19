package user_v1

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// errBadReset is returned for BOTH an unknown user and a bad/expired code — distinguishing them
// would leak which usernames exist.
var errBadReset = errors.New("invalid username or code")

// ResetPasswordWithOtp implements [userv1connect.AuthServiceHandler] — the second step of the
// forgot-password flow. Public. Verify the OTP, then set the new password.
//
// The new password takes effect immediately, and (via writePassword stamping last_password_reset)
// every token the account already held is killed — exactly what you want when recovering a
// possibly-compromised account.
func (s *AuthService) ResetPasswordWithOtp(
	ctx context.Context,
	req *connect.Request[userv1.ResetPasswordWithOtpRequest],
) (*connect.Response[userv1.ResetPasswordWithOtpResponse], error) {
	username := strings.ToLower(strings.TrimSpace(req.Msg.GetUsername()))

	var user user_service_models.User

	err := s.db.
		WithContext(ctx).
		Where("LOWER(username) = ?", username).
		First(&user).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeUnauthenticated, errBadReset)
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	ok, err := s.otp.Verify(req.Msg.GetCode(), user.PhoneNumber)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errBadReset)
	}

	err = writePassword(ctx, s.db, s.resolver, user.ID, req.Msg.GetNewPassword(), time.Now())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// No token is returned: the user logs in fresh with the new password. That is the cleanest
	// end to a recovery flow — a new session, nothing carried over.
	return connect.NewResponse(&userv1.ResetPasswordWithOtpResponse{}), nil
}
