package user_v1

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// RequestPasswordResetOtp implements [userv1connect.AuthServiceHandler] — the first step of the
// forgot-password flow. Public: the caller has no token (they can't log in — that's the point).
//
// IT ALWAYS RETURNS SUCCESS. Revealing whether the username exists, or has a phone on file, would
// make this an account-enumeration oracle. An unknown user, or one with no phone, is a silent
// no-op — indistinguishable from a code actually being sent.
func (s *AuthService) RequestPasswordResetOtp(
	ctx context.Context,
	req *connect.Request[userv1.RequestPasswordResetOtpRequest],
) (*connect.Response[userv1.RequestPasswordResetOtpResponse], error) {
	username := strings.ToLower(strings.TrimSpace(req.Msg.GetUsername()))

	var user user_service_models.User

	err := s.db.
		WithContext(ctx).
		Where("LOWER(username) = ?", username).
		First(&user).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Unknown user — say nothing, do nothing.
			return connect.NewResponse(&userv1.RequestPasswordResetOtpResponse{}), nil
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if user.PhoneNumber == "" {
		// No phone to send to. Still return success — not having a phone is not the caller's to
		// learn.
		return connect.NewResponse(&userv1.RequestPasswordResetOtpResponse{}), nil
	}

	err = s.otp.Send(user.PhoneNumber)
	if err != nil {
		// A provider failure is a SYSTEM error (it leaks nothing about the account), so surface
		// it — but log at the same time so it is diagnosable.
		slog.Error("otp send failed", slog.String("err", err.Error()))

		return nil, connect.NewError(connect.CodeInternal, errors.New("could not send the code"))
	}

	return connect.NewResponse(&userv1.RequestPasswordResetOtpResponse{}), nil
}
