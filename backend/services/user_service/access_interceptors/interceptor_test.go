package access_interceptors

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1/settlement_importerv1connect"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

const testSecret = "test-secret"

// stubResolver models real memberships: a role PER TEAM.
//
// It must be team-aware, not a single fixed role — otherwise a test for the "scope 0 resolves
// to the root team" rule would pass for the wrong reason (the resolver would happily hand back
// a team role when asked about team 1).
type stubResolver struct {
	roles     map[uint64]role_basev1.Role // teamID -> the user's role in it
	suspended bool
	err       error
}

func (s stubResolver) Resolve(_ context.Context, _ uint64, teamID uint64) (Access, error) {
	return Access{
		Role:      s.roles[teamID],
		RootRole:  s.roles[san_auth.RootTeamID],
		Suspended: s.suspended,
	}, s.err
}

func (s stubResolver) Invalidate(_ context.Context, _ uint64) error { return nil }

// memberOf is a resolver for a user holding one role in one team, and nothing in the root team.
func memberOf(teamID uint64, role role_basev1.Role) stubResolver {
	return stubResolver{roles: map[uint64]role_basev1.Role{teamID: role}}
}

func testSigner() *san_auth.Signer {
	return san_auth.NewSigner(testSecret, time.Hour)
}

func tokenFor(t *testing.T, userID uint64) string {
	t.Helper()

	token, err := testSigner().Sign(&role_basev1.Identity{
		IdentityId:   userID,
		Username:     "tester",
		IdentityType: role_basev1.IdentityType_IDENTITY_TYPE_GENERAL_USER,
	}, time.Now())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	return token
}

// call runs a message through the interceptor and reports whether the handler was reached.
// Generic because connect.NewRequest is: it needs the concrete message type, not the interface.
func call[T any](t *testing.T, resolver RoleResolver, msg *T, token string) (bool, error) {
	t.Helper()

	reached := false

	next := func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		reached = true

		return connect.NewResponse(&teamv1.TeamDeleteResponse{}), nil
	}

	req := connect.NewRequest(msg)
	if token != "" {
		req.Header().Set("Authorization", "Bearer "+token)
	}

	handler := NewInterceptor(testSigner(), resolver).WrapUnary(next)

	_, err := handler(context.Background(), req)

	return reached, err
}

func codeOf(err error) connect.Code {
	return connect.CodeOf(err)
}

// ------------------------------------------------------------------ the decision ladder

// allow_all must not even look at the token.
func TestAllowAllIsPublic(t *testing.T) {
	reached, err := call(t, stubResolver{}, &userv1.LoginRequest{Username: "x", Password: "y"}, "")
	if err != nil {
		t.Fatalf("Login should be public, got: %v", err)
	}

	if !reached {
		t.Error("handler not reached")
	}
}

func TestMissingTokenIsUnauthenticated(t *testing.T) {
	_, err := call(t, stubResolver{}, &teamv1.TeamListRequest{}, "")
	if codeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", codeOf(err))
	}
}

// A raw token with no "Bearer " scheme must be REJECTED. The source's TrimPrefix was a no-op on
// an unprefixed value, so it silently accepted them.
func TestBearerSchemeIsRequired(t *testing.T) {
	next := func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		return connect.NewResponse(&teamv1.TeamDeleteResponse{}), nil
	}

	req := connect.NewRequest(&teamv1.TeamListRequest{})
	req.Header().Set("Authorization", tokenFor(t, 1)) // no scheme

	handler := NewInterceptor(testSigner(), stubResolver{}).WrapUnary(next)

	_, err := handler(context.Background(), req)
	if codeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("an unprefixed token must be rejected, got code %v", codeOf(err))
	}
}

func TestBearerSchemeIsCaseInsensitive(t *testing.T) {
	if san_auth.BearerToken("bearer abc") != "abc" {
		t.Error("lowercase scheme should parse")
	}

	if san_auth.BearerToken("BEARER abc") != "abc" {
		t.Error("uppercase scheme should parse")
	}

	if san_auth.BearerToken("abc") != "" {
		t.Error("a token with no scheme must not parse")
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	signer := san_auth.NewSigner(testSecret, -time.Hour) // already expired

	token, err := signer.Sign(&role_basev1.Identity{IdentityId: 1}, time.Now())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	_, err = call(t, stubResolver{}, &teamv1.TeamListRequest{}, token)
	if codeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated for an expired token", codeOf(err))
	}
}

// An identity with NO expiry must count as expired — fail closed.
func TestMissingExpiryFailsClosed(t *testing.T) {
	if !san_auth.IsExpired(&role_basev1.Identity{IdentityId: 1}, time.Now()) {
		t.Fatal("an identity with no expired_at must be treated as EXPIRED, not as never-expiring")
	}
}

// A token signed with a different secret must not verify.
func TestForeignSignatureRejected(t *testing.T) {
	other := san_auth.NewSigner("a-different-secret", time.Hour)

	token, err := other.Sign(&role_basev1.Identity{IdentityId: 1}, time.Now())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	_, err = testSigner().Verify(token, time.Now())
	if !errors.Is(err, san_auth.ErrInvalidToken) {
		t.Fatalf("err = %v, want san_auth.ErrInvalidToken", err)
	}
}

// THE BUG THE SOURCE HAD: a scoped message with team_id left at 0 was a FREE PASS — any valid
// token got in with zero team membership.
//
// Now an unset scope RESOLVES TO THE ROOT TEAM, so the request is authorized against team 1.
// A SELLING_OWNER of team 5 holds nothing in team 1, so they are denied.
func TestScopedRequestWithZeroTeamResolvesToRootScope(t *testing.T) {
	resolver := memberOf(5, role_basev1.Role_ROLE_SELLING_OWNER)

	reached, err := call(t, resolver, &teamv1.TeamUpdateRequest{TeamId: 0}, tokenFor(t, 7))
	if reached {
		t.Fatal("a scoped request with team_id=0 reached the handler for a non-root user — this is the source's free-pass bug")
	}

	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", codeOf(err))
	}
}

// ...but ROOT holds a role in team 1, so a super-admin may call a scoped RPC without naming a
// team. That is the point of resolving to the root scope rather than denying outright.
func TestScopedRequestWithZeroTeamAllowsRoot(t *testing.T) {
	resolver := memberOf(san_auth.RootTeamID, role_basev1.Role_ROLE_ROOT)

	reached, err := call(t, resolver, &teamv1.TeamUpdateRequest{TeamId: 0}, tokenFor(t, 1))
	if err != nil {
		t.Fatalf("ROOT should pass a scoped RPC with an unset team: %v", err)
	}

	if !reached {
		t.Error("handler not reached")
	}
}

func TestRoleInScopeIsAllowed(t *testing.T) {
	resolver := memberOf(5, role_basev1.Role_ROLE_SELLING_OWNER)

	reached, err := call(t, resolver, &teamv1.TeamUpdateRequest{TeamId: 5}, tokenFor(t, 7))
	if err != nil {
		t.Fatalf("SELLING_OWNER should be able to update their own team: %v", err)
	}

	if !reached {
		t.Error("handler not reached")
	}
}

// A role in ANOTHER team must not authorize this one. This is the whole point of use_scope.
func TestRoleInAnotherTeamIsDenied(t *testing.T) {
	resolver := memberOf(5, role_basev1.Role_ROLE_SELLING_OWNER)

	_, err := call(t, resolver, &teamv1.TeamUpdateRequest{TeamId: 6}, tokenFor(t, 7))
	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied — owning team 5 must not authorize team 6", codeOf(err))
	}
}

func TestWrongRoleInScopeIsDenied(t *testing.T) {
	resolver := memberOf(5, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	_, err := call(t, resolver, &teamv1.TeamUpdateRequest{TeamId: 5}, tokenFor(t, 7))
	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied for a staff member updating a team", codeOf(err))
	}
}

// ROOT in the root team bypasses everything, including an unscoped roles-policy.
func TestRootBypassesEverything(t *testing.T) {
	resolver := memberOf(san_auth.RootTeamID, role_basev1.Role_ROLE_ROOT)

	reached, err := call(t, resolver, &teamv1.TeamDeleteRequest{TeamId: 9}, tokenFor(t, 1))
	if err != nil {
		t.Fatalf("ROOT should be able to delete a team: %v", err)
	}

	if !reached {
		t.Error("handler not reached")
	}
}

// An UNSCOPED roles-policy means root/admin only. A mere SELLING_OWNER must not get in.
func TestUnscopedRolesPolicyRequiresRoot(t *testing.T) {
	resolver := memberOf(5, role_basev1.Role_ROLE_SELLING_OWNER)

	_, err := call(t, resolver, &teamv1.TeamDeleteRequest{TeamId: 9}, tokenFor(t, 7))
	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied — TeamDelete is unscoped, so it is root/admin only", codeOf(err))
	}
}

// allow_only_authenticated with no scope field: any valid token passes.
func TestAllowOnlyAuthenticatedUnscoped(t *testing.T) {
	reached, err := call(t, stubResolver{}, &teamv1.TeamListRequest{}, tokenFor(t, 7))
	if err != nil {
		t.Fatalf("TeamList should accept any authenticated caller: %v", err)
	}

	if !reached {
		t.Error("handler not reached")
	}
}

// ------------------------------------------------------------------ suspension

// A SUSPENDED account is refused even on an UNSCOPED allow_only_authenticated RPC.
//
// This is the case that matters: that path used to return before the resolver was ever
// consulted, so a suspended user's existing token kept working on every unscoped RPC until it
// expired. Suspension only bit at login.
func TestSuspendedUserIsRefusedOnUnscopedRPC(t *testing.T) {
	resolver := stubResolver{suspended: true}

	reached, err := call(t, resolver, &teamv1.TeamListRequest{}, tokenFor(t, 7))
	if reached {
		t.Fatal("a suspended user reached the handler — their live token still works")
	}

	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", codeOf(err))
	}
}

// Suspension beats every role, including ROOT.
func TestSuspendedRootIsRefused(t *testing.T) {
	resolver := stubResolver{
		roles:     map[uint64]role_basev1.Role{san_auth.RootTeamID: role_basev1.Role_ROLE_ROOT},
		suspended: true,
	}

	reached, _ := call(t, resolver, &teamv1.TeamDeleteRequest{TeamId: 9}, tokenFor(t, 1))
	if reached {
		t.Fatal("a suspended ROOT reached the handler — suspension must outrank the super-admin bypass")
	}
}

// Suspension does NOT block the public surface: you must still be able to reach Login, or a
// suspended user could not even be told why they are locked out.
func TestSuspendedUserCanStillReachPublicRPCs(t *testing.T) {
	resolver := stubResolver{suspended: true}

	reached, err := call(t, resolver, &userv1.LoginRequest{Username: "x", Password: "y"}, "")
	if err != nil {
		t.Fatalf("allow_all must not consult suspension: %v", err)
	}

	if !reached {
		t.Error("handler not reached")
	}
}

// ------------------------------------------------------------------ descriptor hygiene

// Every use_scope tag in the real contract must be well-formed. This runs against the ACTUAL
// generated descriptors, so it fails the build if anyone adds a bad tag.
func TestValidateDescriptors(t *testing.T) {
	err := san_auth.ValidateDescriptors()
	if err != nil {
		t.Fatalf("the shipped contract has a malformed use_scope tag: %v", err)
	}
}

func TestPolicyOfKnownMessages(t *testing.T) {
	cases := []struct {
		name     string
		message  proto.Message
		wantNil  bool
		allowAll bool
	}{
		{"Login is public", &userv1.LoginRequest{}, false, true},
		{"TeamUpdate has a roles policy", &teamv1.TeamUpdateRequest{}, false, false},
		// A response message carries no policy — proving "no policy" is detectable, which is
		// what makes deny-by-default work.
		{"a response has no policy", &teamv1.TeamUpdateResponse{}, true, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			policy := san_auth.PolicyOf(tc.message.ProtoReflect().Descriptor())

			if tc.wantNil {
				if policy != nil {
					t.Fatalf("want nil policy, got %v", policy)
				}

				return
			}

			if policy == nil {
				t.Fatal("policy is nil — the role_base extension is probably not linked in")
			}

			if policy.GetAllowAll() != tc.allowAll {
				t.Errorf("allow_all = %v, want %v", policy.GetAllowAll(), tc.allowAll)
			}
		})
	}
}

func TestScopeDetection(t *testing.T) {
	teamID, scoped := san_auth.ScopeOf(&teamv1.TeamUpdateRequest{TeamId: 42})
	if !scoped {
		t.Fatal("TeamUpdateRequest must be detected as scoped")
	}

	if teamID != 42 {
		t.Errorf("teamID = %d, want 42", teamID)
	}

	// TeamDeleteRequest HAS a team_id — but it is not tagged use_scope, so it is NOT scoped.
	// The distinction is the whole point: unscoped means root/admin only.
	_, scoped = san_auth.ScopeOf(&teamv1.TeamDeleteRequest{TeamId: 42})
	if scoped {
		t.Error("TeamDeleteRequest has a team_id but no use_scope tag — it must NOT be scoped")
	}
}

// ------------------------------------------------------------------ streams

// stubStreamConn is the minimum connect.StreamingHandlerConn needed to reach the interceptor.
type stubStreamConn struct {
	streamType connect.StreamType
}

func (c stubStreamConn) Spec() connect.Spec                      { return connect.Spec{StreamType: c.streamType} }
func (stubStreamConn) Peer() connect.Peer                        { return connect.Peer{} }
func (stubStreamConn) Receive(any) error                         { return nil }
func (stubStreamConn) Send(any) error                            { return nil }
func (stubStreamConn) RequestHeader() http.Header                { return http.Header{} }
func (stubStreamConn) ResponseHeader() http.Header               { return http.Header{} }
func (stubStreamConn) ResponseTrailer() http.Header              { return http.Header{} }
func (stubStreamConn) Conditional() connect.StreamingHandlerConn { return nil }

// Client and bidi streams carry many messages and no ONE request to read a scope from — refused
// outright, never degraded to root/admin like the source.
func TestClientAndBidiStreamsAreRefused(t *testing.T) {
	for _, streamType := range []connect.StreamType{connect.StreamTypeClient, connect.StreamTypeBidi} {
		reached := false

		handler := NewInterceptor(testSigner(), stubResolver{}).WrapStreamingHandler(
			func(_ context.Context, _ connect.StreamingHandlerConn) error {
				reached = true

				return nil
			})

		err := handler(context.Background(), stubStreamConn{streamType: streamType})
		if codeOf(err) != connect.CodeUnimplemented {
			t.Fatalf("stream type %v: code = %v, want Unimplemented", streamType, codeOf(err))
		}

		if reached {
			t.Errorf("stream type %v: the handler was reached — it must never be", streamType)
		}
	}
}

// A server stream whose spec carries no schema has no readable policy — denied, never passed.
func TestServerStreamWithNoSchemaIsDenied(t *testing.T) {
	handler := NewInterceptor(testSigner(), stubResolver{}).WrapStreamingHandler(
		func(_ context.Context, _ connect.StreamingHandlerConn) error {
			t.Fatal("the handler was reached")

			return nil
		})

	err := handler(context.Background(), stubStreamConn{streamType: connect.StreamTypeServer})
	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", codeOf(err))
	}
}

// streamingImporter is a real server stream, mounted behind the interceptor the way register.go
// mounts one — what it records is what the interceptor let through.
type streamingImporter struct {
	settlement_importerv1connect.UnimplementedSettlementImporterServiceHandler

	reached  bool
	identity uint64
	bearer   string
}

func (s *streamingImporter) TiktokSettlementImport(
	ctx context.Context,
	_ *connect.Request[settlement_importerv1.TiktokSettlementImportRequest],
	stream *connect.ServerStream[settlement_importerv1.TiktokSettlementImportResponse],
) error {
	s.reached = true

	identity, err := san_auth.GetIdentity(ctx)
	if err == nil {
		s.identity = identity.GetIdentityId()
	}

	s.bearer = san_auth.GetBearer(ctx)

	for step := uint32(1); step <= 2; step++ {
		err = stream.Send(&settlement_importerv1.TiktokSettlementImportResponse{Message: "row", Step: step, Count: 2})
		if err != nil {
			return err
		}
	}

	return nil
}

// streamImport calls the mounted stream over HTTP and returns how many messages arrived.
func streamImport(t *testing.T, resolver RoleResolver, teamID uint64, token string) (*streamingImporter, int, error) {
	t.Helper()

	importer := &streamingImporter{}

	mux := http.NewServeMux()
	mux.Handle(settlement_importerv1connect.NewSettlementImporterServiceHandler(
		importer,
		connect.WithInterceptors(NewInterceptor(testSigner(), resolver)),
	))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := settlement_importerv1connect.NewSettlementImporterServiceClient(server.Client(), server.URL)

	req := connect.NewRequest(&settlement_importerv1.TiktokSettlementImportRequest{
		TeamId:      teamID,
		ShopId:      1,
		FileContent: []byte("PK"),
	})
	if token != "" {
		req.Header().Set("Authorization", "Bearer "+token)
	}

	stream, err := client.TiktokSettlementImport(context.Background(), req)
	if err != nil {
		return importer, 0, err
	}
	defer stream.Close()

	received := 0
	for stream.Receive() {
		received++
	}

	return importer, received, stream.Err()
}

// THE PROOF a-server-stream-is-authorized-on-its-request asks for: a member streams, and the
// handler's ctx carries the caller's identity and bearer — what it forwards to other services.
func TestServerStreamIsAuthorizedOnItsRequest(t *testing.T) {
	token := tokenFor(t, 7)

	importer, received, err := streamImport(t, memberOf(5, role_basev1.Role_ROLE_SELLING_CS), 5, token)
	if err != nil {
		t.Fatalf("a CS of team 5 should stream team 5's import: %v", err)
	}

	if received != 2 {
		t.Errorf("received %d messages, want 2", received)
	}

	if importer.identity != 7 {
		t.Errorf("the handler's identity = %d, want 7", importer.identity)
	}

	if importer.bearer != token {
		t.Error("the handler's ctx does not carry the caller's bearer — it could not forward it")
	}
}

// ...and a caller with no role in the REQUEST's team is refused before the handler runs.
func TestServerStreamRefusesANonMemberBeforeTheHandler(t *testing.T) {
	importer, received, err := streamImport(t, memberOf(5, role_basev1.Role_ROLE_SELLING_CS), 6, tokenFor(t, 7))
	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied — a role in team 5 must not open team 6's stream", codeOf(err))
	}

	if importer.reached || received != 0 {
		t.Fatal("the handler ran for a refused request")
	}
}

func TestServerStreamRefusesAWrongRole(t *testing.T) {
	importer, _, err := streamImport(t, memberOf(5, role_basev1.Role_ROLE_WAREHOUSE_STAFF), 5, tokenFor(t, 7))
	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied for a role the policy does not list", codeOf(err))
	}

	if importer.reached {
		t.Fatal("the handler ran for a refused request")
	}
}

func TestServerStreamNeedsAToken(t *testing.T) {
	importer, _, err := streamImport(t, memberOf(5, role_basev1.Role_ROLE_SELLING_OWNER), 5, "")
	if codeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", codeOf(err))
	}

	if importer.reached {
		t.Fatal("the handler ran with no token")
	}
}

// Suspension outranks every role on a stream exactly as on a unary call.
func TestServerStreamRefusesASuspendedMember(t *testing.T) {
	resolver := stubResolver{
		roles:     map[uint64]role_basev1.Role{5: role_basev1.Role_ROLE_SELLING_OWNER},
		suspended: true,
	}

	importer, _, err := streamImport(t, resolver, 5, tokenFor(t, 7))
	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", codeOf(err))
	}

	if importer.reached {
		t.Fatal("a suspended member's stream reached the handler")
	}
}
