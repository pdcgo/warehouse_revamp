package access_interceptors

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// Package access_interceptors is the ACCESS INTERCEPTOR, owned by user_service.
//
// Other services import it to guard their own handlers — user_service owns identity and roles,
// so it owns the thing that enforces them. The generic primitives it builds on (JWT signing,
// reading the proto policy options) live in pkgs/san_auth and have no user_service coupling.
//
// The caller's bearer is stashed in ctx via san_auth.WithBearer so a handler can FORWARD it to
// another service; the resolver is never handed a user id, only a token, or it would become an
// oracle answering "what role does THAT user have?".

type interceptor struct {
	signer   *san_auth.Signer
	resolver RoleResolver
	now      func() time.Time
}

// NewInterceptor enforces the (request_policy) each request message declares.
//
// There is deliberately NO streaming path. A streaming interceptor cannot read the request
// body, so it cannot read the use_scope value: scope would be forced to 0 and any roles-policy
// would silently degrade to root/admin-only, ignoring policy.Roles entirely. Rather than ship
// that trap, every RPC in this system is unary. If a scoped streaming RPC is ever needed,
// authorize it inside the handler after the first Receive.
func NewInterceptor(signer *san_auth.Signer, resolver RoleResolver) connect.Interceptor {
	return &interceptor{signer: signer, resolver: resolver, now: time.Now}
}

func (i *interceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

// WrapStreamingHandler REFUSES every streaming RPC.
//
// It refuses rather than degrading, because degrading is silent. A streaming interceptor cannot
// read the request body (the handler consumes it via conn.Receive), so it cannot read the
// use_scope field: scope would be forced to 0 and any roles-policy would quietly collapse to
// root/admin-only, ignoring policy.Roles entirely. An RPC whose declared policy is not the
// policy being enforced is worse than one with no policy at all.
//
// IF A STREAMING RPC IS EVER NEEDED: authorize INSIDE the handler, per message, after each
// conn.Receive — validate the event that was actually sent, since only then is its scope
// readable. Do not try to make this interceptor do it; it structurally cannot.
func (i *interceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		if conn.Spec().IsClient {
			return next(ctx, conn)
		}

		return connect.NewError(connect.CodeUnimplemented, errors.New(
			"san_auth: streaming RPCs are not authorized by the interceptor - scope cannot be read from a stream; authorize per-message inside the handler after conn.Receive"))
	}
}

func (i *interceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		if req.Spec().IsClient {
			return next(ctx, req)
		}

		message, ok := req.Any().(proto.Message)
		if !ok {
			return nil, connect.NewError(connect.CodeInternal, errors.New("request is not a proto message"))
		}

		policy := san_auth.PolicyOf(message.ProtoReflect().Descriptor())

		// 1. No policy => DENY. Forgetting the option must fail closed.
		if policy == nil {
			return nil, connect.NewError(connect.CodePermissionDenied, errors.New("no access policy"))
		}

		// 2. Public.
		if policy.GetAllowAll() {
			return next(ctx, req)
		}

		// 3. Authenticate.
		token := san_auth.BearerToken(req.Header().Get("Authorization"))
		if token == "" {
			return nil, connect.NewError(connect.CodeUnauthenticated, san_auth.ErrNoToken)
		}

		identity, err := i.signer.Verify(token, i.now())
		if err != nil {
			return nil, connect.NewError(connect.CodeUnauthenticated, err)
		}

		userID := identity.GetIdentityId()
		teamID, isScoped := san_auth.ScopeOf(message)

		ctx = san_auth.WithIdentity(ctx, identity)
		ctx = san_auth.WithScope(ctx, teamID)
		ctx = san_auth.WithBearer(ctx, token)

		// 4. A SCOPED message with team_id = 0 falls back to the ROOT SCOPE.
		//
		// In the source this was a FREE PASS: allow_only_authenticated plus a scope field left
		// unset let any valid token through with zero team membership. Its only defence was a
		// validation constraint present on exactly one message.
		//
		// Resolving it to the root team instead means the request is authorized against team 1,
		// where only ROOT/ADMIN hold a role — so an unspecified scope becomes "root/admin only"
		// rather than "everyone". That keeps the hole shut while still letting a super-admin
		// call a scoped endpoint without naming a team.
		if isScoped && teamID == 0 {
			teamID = san_auth.RootTeamID
			ctx = san_auth.WithScope(ctx, teamID)
		}

		// 5. Resolve the caller's access ONCE.
		//
		// This runs for EVERY authenticated request — including the allow_only_authenticated
		// fast path below — because SUSPENSION is checked here. Returning early before this
		// point (as the previous version did) would mean a suspended user's existing token kept
		// authorizing every unscoped RPC until it expired.
		access, err := i.resolver.Resolve(ctx, userID, teamID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		// 6. SUSPENDED accounts are refused — whatever their roles say, and whatever token they
		// still hold. A suspension that only bites at login is not a suspension: the account
		// stays fully usable for the whole lifetime of a token it already has.
		if access.Suspended {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("account is suspended"))
		}

		// 7. Unscoped + allow_only_authenticated: a valid, unsuspended token is enough.
		if !isScoped && policy.GetAllowOnlyAuthenticated() {
			return next(ctx, req)
		}

		// 8. ROOT / ADMIN in the root team are global super-admins.
		if access.RootRole == role_basev1.Role_ROLE_ROOT || access.RootRole == role_basev1.Role_ROLE_ADMIN {
			return next(ctx, req)
		}

		// 9. Scoped + allow_only_authenticated: ANY role in that team.
		if policy.GetAllowOnlyAuthenticated() {
			if access.Role == role_basev1.Role_ROLE_UNSPECIFIED {
				return nil, connect.NewError(connect.CodePermissionDenied,
					errors.New("requires a role in the team"))
			}

			return next(ctx, req)
		}

		// 10. Roles policy.
		//
		// An UNSCOPED roles-policy is evaluated against the root team — which is why it only ever
		// passes for root/admin, already handled at step 8. So reaching here unscoped is a
		// denial, and that is correct: a roles-policy with no use_scope field (e.g. TeamCreate,
		// TeamDelete) means "root/admin only", and saying so out loud beats the source's silent
		// `teamID = 1` coercion.
		if !isScoped {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("requires root or admin"))
		}

		for _, allowed := range policy.GetRoles() {
			if access.Role == allowed {
				return next(ctx, req)
			}
		}

		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("insufficient role"))
	}
}
