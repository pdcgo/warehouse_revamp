package user_v1_test

import (
	"context"
	"net/url"
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func connectReq(clientID string, teamID uint64) *connect.Request[userv1.AgentConnectRequest] {
	return connect.NewRequest(&userv1.AgentConnectRequest{
		ClientId:            clientID,
		RedirectUri:         agentRedirect,
		CodeChallenge:       agentChallenge(),
		CodeChallengeMethod: "S256",
		State:               "the-agents-state",
		TeamId:              teamID,
		Name:                "ChatGPT, Heri's laptop",
	})
}

// THE OWNER CONNECTS: the answer is the agent's redirect carrying a code and its state — and the code trades for a
// credential reading the team picked.
func TestAgentConnect_TheOwnerConnectsTheTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)

	owner := insertUser(t, db, "owner", "pw")
	grantRole(t, db, 5, owner, role_basev1.Role_ROLE_SELLING_OWNER)

	res, err := svc.AgentConnect(ctxWithIdentity(owner, "owner"), connectReq(clientID, 5))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	redirect, err := url.Parse(res.Msg.GetRedirectUrl())
	if err != nil {
		t.Fatalf("redirect: %v", err)
	}

	if redirect.Host != "chatgpt.com" || redirect.Query().Get("state") != "the-agents-state" || redirect.Query().Get("code") == "" {
		t.Fatalf("redirect = %s, want the registered one with a code and the state", redirect)
	}

	_, credential, err := store.Exchange(context.Background(), redirect.Query().Get("code"), clientID, agentRedirect, agentVerifier)
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}

	if credential.UserID != owner || credential.TeamID != 5 || credential.Name != "ChatGPT, Heri's laptop" {
		t.Fatalf("credential = %+v, want the owner's, team 5, named", credential)
	}
}

// CS AND STAFF CONNECT ONLY ONCE THE OWNER ALLOWS IT (the-owner-decides-who-connects-an-agent).
func TestAgentConnect_CSNeedsTheOwnersSwitch(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)

	cs := insertUser(t, db, "cs", "pw")
	grantRole(t, db, 5, cs, role_basev1.Role_ROLE_SELLING_CS)
	ctx := ctxWithIdentity(cs, "cs")

	_, err := svc.AgentConnect(ctx, connectReq(clientID, 5))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a CS with the switch off = %v, want PermissionDenied", err)
	}

	db.Create(&user_service_models.TeamAgentPolicy{TeamID: 5, MembersMayConnect: true})

	_, err = svc.AgentConnect(ctx, connectReq(clientID, 5))
	if err != nil {
		t.Fatalf("a CS with the switch on was refused: %v", err)
	}
}

// Only a member connects a team — and only root or the administrator connects EVERY team (team 0).
func TestAgentConnect_EveryTeamIsRootsAlone(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)

	owner := insertUser(t, db, "owner", "pw")
	grantRole(t, db, 5, owner, role_basev1.Role_ROLE_SELLING_OWNER)
	ctx := ctxWithIdentity(owner, "owner")

	_, err := svc.AgentConnect(ctx, connectReq(clientID, 6))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("connecting a team the person is not in = %v, want PermissionDenied", err)
	}

	_, err = svc.AgentConnect(ctx, connectReq(clientID, 0))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("an owner connecting every team = %v, want PermissionDenied", err)
	}

	// The seeded root (user 1, ROOT in team 1) connects every team, and any team.
	_, err = svc.AgentConnect(ctxWithIdentity(1, "root"), connectReq(clientID, 0))
	if err != nil {
		t.Fatalf("root connecting every team was refused: %v", err)
	}

	_, err = svc.AgentConnect(ctxWithIdentity(1, "root"), connectReq(clientID, 6))
	if err != nil {
		t.Fatalf("root connecting team 6 was refused: %v", err)
	}
}

// A connection must be named, and its redirect must be the agent's.
func TestAgentConnect_RefusesAnUnnamedOrMisdirected(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)
	ctx := ctxWithIdentity(1, "root")

	unnamed := connectReq(clientID, 5)
	unnamed.Msg.Name = "   "

	_, err := svc.AgentConnect(ctx, unnamed)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an unnamed connection = %v, want InvalidArgument", err)
	}

	elsewhere := connectReq(clientID, 5)
	elsewhere.Msg.RedirectUri = "https://evil.example.com/cb"

	_, err = svc.AgentConnect(ctx, elsewhere)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an unregistered redirect = %v, want InvalidArgument", err)
	}
}
