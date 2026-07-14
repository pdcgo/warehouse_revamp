package user_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// ResetPassword implements [userv1connect.UserServiceHandler] — the caller changes their OWN
// password.
//
// THE SUBJECT IS THE TOKEN HOLDER, NEVER A REQUEST FIELD. The request has no user_id, and must
// never grow one: the source took user_id from the request under a mere
// allow_only_authenticated policy, so ANY logged-in user could reset ANY account's password
// given only its old password.
func (s *Service) ResetPassword(
	ctx context.Context,
	req *connect.Request[userv1.ResetPasswordRequest],
) (*connect.Response[userv1.ResetPasswordResponse], error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	var user user_service_models.User

	err = s.db.
		WithContext(ctx).
		Where("id = ?", identity.GetIdentityId()).
		First(&user).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("user no longer exists"))
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Proving you know the CURRENT password is what stops a stolen token from being escalated
	// into a permanent account takeover.
	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Msg.GetOldPassword()))
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("current password is incorrect"))
	}

	now := time.Now()

	token, err := s.setPassword(ctx, &user, req.Msg.GetNewPassword(), now)
	if err != nil {
		return nil, err
	}

	// Hand back a FRESH token: the caller's existing one was minted before the reset, and the
	// whole point of last_password_reset is that such tokens are now dead — including theirs.
	// Without this, changing your password would log you out of your own session.
	return connect.NewResponse(&userv1.ResetPasswordResponse{Token: token}), nil
}

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

// setPassword hashes and stores the new password, stamps last_password_reset (which kills every
// token minted before now — see CheckAccess), and mints a replacement token for the user.
func (s *Service) setPassword(
	ctx context.Context,
	user *user_service_models.User,
	password string,
	now time.Time,
) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", connect.NewError(connect.CodeInternal, err)
	}

	err = s.db.
		WithContext(ctx).
		Model(&user_service_models.User{}).
		Where("id = ?", user.ID).
		Updates(map[string]any{
			"password":            string(hash),
			"last_password_reset": now,
			"updated_at":          gorm.Expr("NOW()"),
		}).
		Error
	if err != nil {
		return "", connect.NewError(connect.CodeInternal, err)
	}

	// The roles have not changed, but a password reset is a security event — drop the cached
	// roles so nothing stale survives it.
	_ = s.resolver.Invalidate(ctx, user.ID)

	// Mint a token whose issue time is AFTER the reset, so it survives the check that just
	// killed all the older ones.
	token, err := s.signer.Sign(identityFor(user), now)
	if err != nil {
		return "", connect.NewError(connect.CodeInternal, err)
	}

	return token, nil
}
