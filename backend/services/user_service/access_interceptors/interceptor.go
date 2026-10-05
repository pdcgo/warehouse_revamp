package access_interceptors

import (
	"context"
	"errors"
	"net/http"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"

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
// A unary call and a SERVER stream are authorized by the same ladder, on the one request each
// carries (#a-server-stream-is-authorized-on-its-request). Client and bidi streams stay refused:
// they carry many messages, and "the request" means nothing there.
func NewInterceptor(signer *san_auth.Signer, resolver RoleResolver) connect.Interceptor {
	return &interceptor{signer: signer, resolver: resolver, now: time.Now}
}

func (i *interceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

// WrapStreamingHandler authorizes a SERVER stream on its one request, and refuses every other kind.
//
// The token lives in the HEADERS, so it is checked before the handler runs — and the identity and
// bearer ride into the handler's ctx exactly as a unary call's do. The scope lives in the BODY,
// which connect-go reads through conn.Receive INSIDE `next`, so the rest of the ladder runs there,
// on the decoded request, before the handler's body sees it: a refused request never reaches it.
//
// ⚠ WHAT A STREAM HANDLER DOES NOT GET: the scope and the caller's role in ctx. Both are known only
// after Receive, and `next` already holds its ctx by then. A stream handler reads `team_id` off its
// own request — the check itself has already run on it.
//
// ⚠ CLIENT AND BIDI STREAMS ARE REFUSED, not degraded: they carry many messages, each with its own
// scope, so there is no one request to authorize. An RPC whose declared policy is not the policy
// being enforced is worse than one that cannot be called.
func (i *interceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		spec := conn.Spec()
		if spec.IsClient {
			return next(ctx, conn)
		}

		if spec.StreamType != connect.StreamTypeServer {
			return connect.NewError(connect.CodeUnimplemented, errors.New(
				"san_auth: client and bidi streams are not authorized by the interceptor - they carry no one request to read the scope from"))
		}

		// The policy is on the REQUEST MESSAGE, and the request has not been read yet — so it is read
		// off the method's declared input instead. No schema means no policy, and no policy is a denial.
		method, ok := spec.Schema.(protoreflect.MethodDescriptor)
		if !ok {
			return connect.NewError(connect.CodePermissionDenied, errors.New("no access policy"))
		}

		ctx, gate, err := i.authenticate(ctx, method.Input(), conn.RequestHeader())
		if err != nil {
			return err
		}

		if gate == nil {
			return next(ctx, conn)
		}

		return next(ctx, &authorizedStream{StreamingHandlerConn: conn, ctx: ctx, gate: gate})
	}
}

// authorizedStream runs the scope half of the ladder on a server stream's request, as it is read.
type authorizedStream struct {
	connect.StreamingHandlerConn

	ctx        context.Context
	gate       *gate
	authorized bool
}

// Receive decodes the request and authorizes it before handing it back.
//
// connect-go calls it twice for a server stream — the request, then an expected io.EOF — so only
// the first message that decodes is checked; a refusal returns before the handler body runs.
func (s *authorizedStream) Receive(msg any) error {
	err := s.StreamingHandlerConn.Receive(msg)
	if err != nil || s.authorized {
		return err
	}

	message, ok := msg.(proto.Message)
	if !ok {
		return connect.NewError(connect.CodeInternal, errors.New("request is not a proto message"))
	}

	_, err = s.gate.authorize(s.ctx, message)
	if err != nil {
		return err
	}

	s.authorized = true

	return nil
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

		ctx, gate, err := i.authenticate(ctx, message.ProtoReflect().Descriptor(), req.Header())
		if err != nil {
			return nil, err
		}

		if gate != nil {
			ctx, err = gate.authorize(ctx, message)
			if err != nil {
				return nil, err
			}
		}

		return next(ctx, req)
	}
}

// gate is what the header half of the ladder hands the body half: who is calling, under which
// policy. nil means the request is public and nothing further is checked.
type gate struct {
	interceptor *interceptor
	policy      *role_basev1.RequestPolicy
	userID      uint64
}

// authenticate is the HEADER half of the ladder — steps 1 to 3. It needs only the request's
// DESCRIPTOR, which is what lets a server stream run it before its request is read.
func (i *interceptor) authenticate(
	ctx context.Context,
	request protoreflect.MessageDescriptor,
	header http.Header,
) (context.Context, *gate, error) {
	policy := san_auth.PolicyOf(request)

	// 1. No policy => DENY. Forgetting the option must fail closed.
	if policy == nil {
		return ctx, nil, connect.NewError(connect.CodePermissionDenied, errors.New("no access policy"))
	}

	// 2. Public.
	if policy.GetAllowAll() {
		return ctx, nil, nil
	}

	// 3. Authenticate.
	token := san_auth.BearerToken(header.Get("Authorization"))
	if token == "" {
		return ctx, nil, connect.NewError(connect.CodeUnauthenticated, san_auth.ErrNoToken)
	}

	identity, err := i.signer.Verify(token, i.now())
	if err != nil {
		return ctx, nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	ctx = san_auth.WithIdentity(ctx, identity)
	ctx = san_auth.WithBearer(ctx, token)

	return ctx, &gate{interceptor: i, policy: policy, userID: identity.GetIdentityId()}, nil
}

// authorize is the BODY half of the ladder — steps 4 to 10, which need the request's scope.
func (g *gate) authorize(ctx context.Context, message proto.Message) (context.Context, error) {
	i := g.interceptor
	policy := g.policy
	userID := g.userID

	teamID, isScoped := san_auth.ScopeOf(message)

	ctx = san_auth.WithScope(ctx, teamID)

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
		return ctx, connect.NewError(connect.CodeInternal, err)
	}

	// 5b. CARRY THE RESOLVED ROLE FORWARD, so a handler can tell on whose behalf it is acting
	// without resolving membership a second time.
	//
	// ⚠ NOT FOR AUTHORIZATION — every decision below is made here. It exists so a write can record
	// whether it was an OVERRIDE: ROLE_UNSPECIFIED means the caller holds no role in the scoped
	// team and therefore got in by the root-team bypass at step 8, which is exactly what
	// terms-are-team-scoped-root-is-global defines an override to be.
	ctx = san_auth.WithCallerRole(ctx, access.Role)

	// 6. SUSPENDED accounts are refused — whatever their roles say, and whatever token they
	// still hold. A suspension that only bites at login is not a suspension: the account
	// stays fully usable for the whole lifetime of a token it already has.
	if access.Suspended {
		return ctx, connect.NewError(connect.CodePermissionDenied,
			errors.New("account is suspended"))
	}

	// 7. Unscoped + allow_only_authenticated: a valid, unsuspended token is enough.
	if !isScoped && policy.GetAllowOnlyAuthenticated() {
		return ctx, nil
	}

	// 8. ROOT / ADMIN in the root team are global super-admins.
	if access.RootRole == role_basev1.Role_ROLE_ROOT || access.RootRole == role_basev1.Role_ROLE_ADMINISTRATOR {
		return ctx, nil
	}

	// 9. Scoped + allow_only_authenticated: ANY role in that team.
	if policy.GetAllowOnlyAuthenticated() {
		if access.Role == role_basev1.Role_ROLE_UNSPECIFIED {
			return ctx, connect.NewError(connect.CodePermissionDenied,
				errors.New("requires a role in the team"))
		}

		return ctx, nil
	}

	// 10. Roles policy.
	//
	// An UNSCOPED roles-policy is evaluated against the root team — which is why it only ever
	// passes for root/admin, already handled at step 8. So reaching here unscoped is a
	// denial, and that is correct: a roles-policy with no use_scope field (e.g. TeamCreate,
	// TeamDelete) means "root/admin only", and saying so out loud beats the source's silent
	// `teamID = 1` coercion.
	if !isScoped {
		return ctx, connect.NewError(connect.CodePermissionDenied,
			errors.New("requires root or admin"))
	}

	for _, allowed := range policy.GetRoles() {
		if access.Role == allowed {
			return ctx, nil
		}
	}

	return ctx, connect.NewError(connect.CodePermissionDenied, errors.New("insufficient role"))
}
