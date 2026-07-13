package user_service

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// errBadCredentials is returned for BOTH an unknown username and a wrong password.
//
// Distinguishing them turns login into a username oracle: an attacker learns which accounts
// exist and can target them. One message, one code, both cases.
var errBadCredentials = errors.New("invalid username or password")

// Login implements [userv1connect.AuthServiceHandler].
//
// Public (allow_all) — the interceptor never reads a token here, so there is no identity in
// ctx.
func (s *AuthService) Login(
	ctx context.Context,
	req *connect.Request[userv1.LoginRequest],
) (*connect.Response[userv1.LoginResponse], error) {
	username := strings.ToLower(strings.TrimSpace(req.Msg.GetUsername()))

	var user user_service_models.User

	err := s.db.
		WithContext(ctx).
		Where("LOWER(username) = ?", username).
		First(&user).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Compare against a dummy hash anyway, so a missing user and a wrong password take
			// roughly the same time. Returning early here leaks account existence through a
			// timing difference.
			_ = bcrypt.CompareHashAndPassword(
				[]byte("$2a$10$abcdefghijklmnopqrstuv0000000000000000000000000000000000"),
				[]byte(req.Msg.GetPassword()),
			)

			return nil, connect.NewError(connect.CodeUnauthenticated, errBadCredentials)
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// An empty hash is the "no password set" marker (the seeded root account). bcrypt would
	// reject it anyway; being explicit makes the intent readable.
	if user.Password == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, errBadCredentials)
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Msg.GetPassword()))
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errBadCredentials)
	}

	// Checked AFTER the password, deliberately: telling an unauthenticated caller "this account
	// is suspended" confirms the account exists.
	if user.IsSuspended {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("account is suspended"))
	}

	identity := identityFor(&user)
	identity.Agent = req.Msg.GetAgent()
	identity.AgentVersion = req.Msg.GetAgentVersion()

	token, err := s.signer.Sign(identity, time.Now())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Drop any stale cached roles for this user. Cheap insurance: a login is exactly when a
	// user expects their permissions to be current.
	_ = s.resolver.Invalidate(ctx, user.ID)

	return connect.NewResponse(&userv1.LoginResponse{
		Token:    token,
		Identity: identity,
	}), nil
}
