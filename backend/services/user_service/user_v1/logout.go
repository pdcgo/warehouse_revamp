package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// Logout implements [userv1connect.AuthServiceHandler].
//
// Public (allow_all), so no identity is in ctx — it parses the Authorization header itself.
// That is deliberate: logging out with an already-expired token must still work.
//
// ⚠ THE TOKEN REMAINS VALID until it expires. This drops the user's cached roles, nothing more.
// Logout is a client-side act: the client discards the token. Real revocation needs a
// denylist — see plans/user_service/brainstorming.md §6.5.
func (s *AuthService) Logout(
	ctx context.Context,
	req *connect.Request[userv1.LogoutRequest],
) (*connect.Response[userv1.LogoutResponse], error) {
	token := san_auth.BearerToken(req.Header().Get("Authorization"))
	if token == "" {
		return connect.NewResponse(&userv1.LogoutResponse{}), nil
	}

	// Parse, not Verify: an expired token should still let you log out cleanly.
	identity, err := s.signer.Parse(token)
	if err != nil {
		return connect.NewResponse(&userv1.LogoutResponse{}), nil
	}

	_ = s.resolver.Invalidate(ctx, identity.GetIdentityId())

	return connect.NewResponse(&userv1.LogoutResponse{}), nil
}
