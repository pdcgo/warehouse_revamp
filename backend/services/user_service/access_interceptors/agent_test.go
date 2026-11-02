package access_interceptors

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// ── an AI agent's credential (an-agent-only-reads-for-now, an-agent-gets-its-own-team-credential) ──────────────
//
// These run through REAL Connect handlers, not a hand-built request: whether an RPC is a read is its generated spec's
// idempotency level, and a request made with connect.NewRequest carries no spec at all.

const (
	agentToken      = AgentTokenPrefix + "one-team"
	everyTeamToken  = AgentTokenPrefix + "every-team"
	agentPerson     = uint64(7)
	agentTeam       = uint64(5)
	otherTeam       = uint64(6)
	revokedOrUnseen = AgentTokenPrefix + "revoked"
)

type stubAgents map[string]*AgentGrant

func (s stubAgents) VerifyAgent(_ context.Context, token string) (*AgentGrant, error) {
	grant, ok := s[token]
	if !ok {
		return nil, errors.New("unknown agent credential")
	}

	return grant, nil
}

var agents = stubAgents{
	agentToken:     {CredentialID: 1, UserID: agentPerson, TeamID: agentTeam},
	everyTeamToken: {CredentialID: 2, UserID: agentPerson, TeamID: 0},
}

// seen records what the handler was handed, so a test can assert on whose call it ran as.
type seen struct {
	identity uint64
	grant    *AgentGrant
}

type positions struct {
	liabilityv1connect.UnimplementedLiabilityServiceHandler
	seen *seen
}

func (p positions) LiabilityPositionList(
	ctx context.Context,
	_ *connect.Request[liabilityv1.LiabilityPositionListRequest],
) (*connect.Response[liabilityv1.LiabilityPositionListResponse], error) {
	identity, _ := san_auth.GetIdentity(ctx)
	p.seen.identity = identity.GetIdentityId()
	p.seen.grant = AgentGrantFrom(ctx)

	return connect.NewResponse(&liabilityv1.LiabilityPositionListResponse{}), nil
}

type teams struct {
	teamv1connect.UnimplementedTeamServiceHandler
}

func (teams) TeamInfoUpdate(
	context.Context,
	*connect.Request[teamv1.TeamInfoUpdateRequest],
) (*connect.Response[teamv1.TeamInfoUpdateResponse], error) {
	return connect.NewResponse(&teamv1.TeamInfoUpdateResponse{}), nil
}

// agentServer mounts a read (LiabilityPositionList) and a write (TeamInfoUpdate) behind the interceptor.
func agentServer(t *testing.T, resolver RoleResolver, verifier AgentVerifier) (liabilityv1connect.LiabilityServiceClient, teamv1connect.TeamServiceClient, *seen) {
	t.Helper()

	var opts []Option
	if verifier != nil {
		opts = append(opts, WithAgentVerifier(verifier))
	}

	interceptors := connect.WithInterceptors(NewInterceptor(testSigner(), resolver, opts...))
	record := &seen{}

	mux := http.NewServeMux()
	mux.Handle(liabilityv1connect.NewLiabilityServiceHandler(positions{seen: record}, interceptors))
	mux.Handle(teamv1connect.NewTeamServiceHandler(teams{}, interceptors))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return liabilityv1connect.NewLiabilityServiceClient(server.Client(), server.URL),
		teamv1connect.NewTeamServiceClient(server.Client(), server.URL),
		record
}

func positionsOf(team uint64, token string) *connect.Request[liabilityv1.LiabilityPositionListRequest] {
	req := connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
		TeamId: team,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 10},
	})
	req.Header().Set("Authorization", "Bearer "+token)

	return req
}

// The owner of team 5 — and of team 6, so a refusal of team 6 is the CREDENTIAL's, never the person's.
var ownerOfBoth = stubResolver{roles: map[uint64]role_basev1.Role{
	agentTeam: role_basev1.Role_ROLE_SELLING_OWNER,
	otherTeam: role_basev1.Role_ROLE_SELLING_OWNER,
}}

// AN AGENT READS ITS TEAM — as its person: the handler sees the person's identity and the grant beside it.
func TestAgent_ReadsItsTeamAsItsPerson(t *testing.T) {
	liability, _, record := agentServer(t, ownerOfBoth, agents)

	_, err := liability.LiabilityPositionList(context.Background(), positionsOf(agentTeam, agentToken))
	if err != nil {
		t.Fatalf("an agent reading its own team was refused: %v", err)
	}

	if record.identity != agentPerson || record.grant == nil || record.grant.CredentialID != 1 {
		t.Fatalf("the handler ran as %d with grant %+v, want person %d with credential 1", record.identity, record.grant, agentPerson)
	}
}

// ⚠ AN AGENT NEVER WRITES — refused before the handler, whatever its person may do (an-agent-only-reads-for-now).
func TestAgent_AWriteIsRefused(t *testing.T) {
	_, team, _ := agentServer(t, ownerOfBoth, agents)

	req := connect.NewRequest(&teamv1.TeamInfoUpdateRequest{TeamId: agentTeam})
	req.Header().Set("Authorization", "Bearer "+agentToken)

	_, err := team.TeamInfoUpdate(context.Background(), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("an agent's write answered %v, want PermissionDenied", err)
	}
}

// The same write with the person's own session goes through — the refusal is the agent's alone.
func TestAgent_ThePersonsSessionStillWrites(t *testing.T) {
	_, team, _ := agentServer(t, ownerOfBoth, agents)

	req := connect.NewRequest(&teamv1.TeamInfoUpdateRequest{TeamId: agentTeam})
	req.Header().Set("Authorization", "Bearer "+tokenFor(t, agentPerson))

	_, err := team.TeamInfoUpdate(context.Background(), req)
	if err != nil {
		t.Fatalf("the person's own write was refused: %v", err)
	}
}

// ONE TEAM: a credential for team 5 cannot read team 6, though its person owns both.
func TestAgent_AnotherTeamIsRefused(t *testing.T) {
	liability, _, _ := agentServer(t, ownerOfBoth, agents)

	_, err := liability.LiabilityPositionList(context.Background(), positionsOf(otherTeam, agentToken))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a one-team agent reading another team answered %v, want PermissionDenied", err)
	}
}

// A revoked, expired or unknown credential is not a credential.
func TestAgent_AnUnknownCredentialIsUnauthenticated(t *testing.T) {
	liability, _, _ := agentServer(t, ownerOfBoth, agents)

	_, err := liability.LiabilityPositionList(context.Background(), positionsOf(agentTeam, revokedOrUnseen))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("an unknown agent credential answered %v, want Unauthenticated", err)
	}
}

// With no verifier wired, an agent's bearer is refused like any token that does not parse.
func TestAgent_NoVerifierRefusesAgents(t *testing.T) {
	liability, _, _ := agentServer(t, ownerOfBoth, nil)

	_, err := liability.LiabilityPositionList(context.Background(), positionsOf(agentTeam, agentToken))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("an agent with no verifier answered %v, want Unauthenticated", err)
	}
}

// ROOT'S AGENT READS EVERY TEAM (a-roots-agent-reads-every-team) — while its person still holds root's bypass.
func TestAgent_RootsAgentReadsEveryTeam(t *testing.T) {
	root := stubResolver{roles: map[uint64]role_basev1.Role{san_auth.RootTeamID: role_basev1.Role_ROLE_ROOT}}
	liability, _, _ := agentServer(t, root, agents)

	_, err := liability.LiabilityPositionList(context.Background(), positionsOf(otherTeam, everyTeamToken))
	if err != nil {
		t.Fatalf("root's every-team agent was refused team %d: %v", otherTeam, err)
	}
}

// …and stops the moment the person loses it: the credential carries no bypass of its own.
func TestAgent_AnEveryTeamAgentStopsWithItsPersonsBypass(t *testing.T) {
	liability, _, _ := agentServer(t, ownerOfBoth, agents)

	_, err := liability.LiabilityPositionList(context.Background(), positionsOf(agentTeam, everyTeamToken))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("an every-team agent of a person without root answered %v, want PermissionDenied", err)
	}
}

// A ONE-TEAM agent of a ROOT person reads its team only — root's bypass does not widen the credential, and an unscoped
// root-only policy is out of its reach too.
func TestAgent_ARootPersonsOneTeamAgentStaysInItsTeam(t *testing.T) {
	root := stubResolver{roles: map[uint64]role_basev1.Role{san_auth.RootTeamID: role_basev1.Role_ROLE_ROOT}}
	liability, _, _ := agentServer(t, root, agents)

	_, err := liability.LiabilityPositionList(context.Background(), positionsOf(otherTeam, agentToken))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a root person's one-team agent reading another team answered %v, want PermissionDenied", err)
	}

	unscoped := &gate{
		interceptor: &interceptor{resolver: root},
		policy:      &role_basev1.RequestPolicy{Roles: []role_basev1.Role{role_basev1.Role_ROLE_ROOT}},
		userID:      agentPerson,
		agent:       agents[agentToken],
	}

	_, err = unscoped.authorize(context.Background(), &teamv1.TeamDeleteRequest{})
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a one-team agent on an unscoped root-only policy answered %v, want PermissionDenied", err)
	}
}
