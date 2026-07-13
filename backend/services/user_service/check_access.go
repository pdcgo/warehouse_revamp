package user_service

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// renewGrace bounds the sliding session.
//
// The source re-signed ANY signature-valid token, however long expired, with a fresh 24h —
// forever, with no revocation and no absolute cap. Combined with a token in localStorage, one
// stolen token was a PERMANENT session. A token expired longer than this is simply dead: log in
// again.
const renewGrace = 7 * 24 * time.Hour

// CheckAccess implements [userv1connect.AuthServiceHandler].
//
// The frontend calls it on every page load: it validates the token, renews it (sliding session),
// and reports the caller's role in a team.
//
// Public (allow_all) because the token arrives in the BODY — the caller does not yet know
// whether it is any good.
func (s *AuthService) CheckAccess(
	ctx context.Context,
	req *connect.Request[userv1.CheckAccessRequest],
) (*connect.Response[userv1.CheckAccessResponse], error) {
	// Parse, not Verify: an expired-but-authentic token is exactly what we are here to renew.
	identity, err := s.signer.Parse(req.Msg.GetToken())
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	now := time.Now()

	// BOUND THE RENEWAL. A token expired beyond the grace window cannot be resurrected.
	expiry := identity.GetExpiredAt()
	if expiry == nil || now.Sub(expiry.AsTime()) > renewGrace {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("token expired"))
	}

	// RE-READ THE USER. Renewal is the moment to honour a suspension or a password reset — the
	// source never did, so a suspended user's token kept working (and kept renewing) until they
	// stopped using it.
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

	if user.IsSuspended {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("account is suspended"))
	}

	// A PASSWORD RESET KILLS EVERY TOKEN MINTED BEFORE IT.
	//
	// The Identity carries only expired_at, so the issue time is recovered as
	// (expired_at - TTL). If that is before the reset, this token was minted with the old
	// password and must not be renewed — otherwise "I changed my password because it leaked"
	// does nothing to the attacker still holding a valid token.
	if user.LastPasswordReset != nil {
		issuedAt := expiry.AsTime().Add(-s.signer.TTL())

		if issuedAt.Before(*user.LastPasswordReset) {
			return nil, connect.NewError(connect.CodeUnauthenticated,
				errors.New("token predates a password reset"))
		}
	}

	token, err := s.signer.Sign(identity, now)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	res := &userv1.CheckAccessResponse{
		Identity: identity,
		Token:    token,
		Role:     role_basev1.Role_ROLE_UNSPECIFIED,
	}

	if teamID := req.Msg.GetTeamId(); teamID > 0 {
		access, err := s.resolver.Resolve(ctx, user.ID, teamID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		res.Role = access.Role
	}

	return connect.NewResponse(res), nil
}
