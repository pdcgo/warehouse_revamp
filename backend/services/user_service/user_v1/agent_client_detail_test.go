package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The connect page names the agent — and refuses a redirect it never registered, so it never sends the browser there.
func TestAgentClientDetail(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)
	ctx := ctxWithIdentity(1, "root")

	res, err := svc.AgentClientDetail(ctx, connect.NewRequest(&userv1.AgentClientDetailRequest{ClientId: clientID, RedirectUri: agentRedirect}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if res.Msg.GetClientName() != "ChatGPT" {
		t.Fatalf("client name = %q, want ChatGPT", res.Msg.GetClientName())
	}

	_, err = svc.AgentClientDetail(ctx, connect.NewRequest(&userv1.AgentClientDetailRequest{ClientId: clientID, RedirectUri: "https://evil.example.com/cb"}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an unregistered redirect = %v, want InvalidArgument", err)
	}

	_, err = svc.AgentClientDetail(ctx, connect.NewRequest(&userv1.AgentClientDetailRequest{ClientId: "agent_never", RedirectUri: agentRedirect}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown client = %v, want NotFound", err)
	}
}
