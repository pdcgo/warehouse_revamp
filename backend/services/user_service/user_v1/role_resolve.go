package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// RoleResolve implements [userv1connect.UserServiceHandler].
//
// This is how every OTHER service checks a caller's role without touching this service's tables.
// It is the RPC behind san_auth's RPCRoleResolver, and it is the reason team_service can be
// guarded without importing user_service.
//
// ⚠ THE USER IS THE TOKEN HOLDER, NEVER A REQUEST FIELD. There is no user_id in the request, and
// there must never be one: an RPC that answers "what role does user X have in team Y?" for an
// arbitrary X is an authorization oracle.
func (s *Service) RoleResolve(
	ctx context.Context,
	req *connect.Request[userv1.RoleResolveRequest],
) (*connect.Response[userv1.RoleResolveResponse], error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	access, err := s.resolver.Resolve(ctx, identity.GetIdentityId(), req.Msg.GetTeamId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.RoleResolveResponse{
		Role:      access.Role,
		RootRole:  access.RootRole,
		Suspended: access.Suspended,
	}), nil
}
