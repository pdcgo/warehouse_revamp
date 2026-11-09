package user_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
)

// REVOKING ONE OF MINE ends it at once; somebody else's is NotFound.
func TestAgentConnectionRevoke(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)

	me := insertUser(t, db, "me", "pw")
	other := insertUser(t, db, "other", "pw")

	code, _ := store.MintCode(context.Background(), agent_credentials.CodeGrant{
		ClientID: clientID, RedirectURI: agentRedirect, CodeChallenge: agentChallenge(), UserID: me, TeamID: 5, Name: "laptop",
	})
	token, mine, _ := store.Exchange(context.Background(), code, clientID, agentRedirect, agentVerifier)
	theirs := connectAgent(t, store, clientID, other, 5, "theirs")

	ctx := ctxWithIdentity(me, "me")

	_, err := svc.AgentConnectionRevoke(ctx, connect.NewRequest(&userv1.AgentConnectionRevokeRequest{ConnectionId: theirs.ID}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("revoking somebody else's = %v, want NotFound", err)
	}

	_, err = svc.AgentConnectionRevoke(ctx, connect.NewRequest(&userv1.AgentConnectionRevokeRequest{ConnectionId: mine.ID}))
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}

	_, err = store.VerifyAgent(context.Background(), token)
	if !errors.Is(err, access_interceptors.ErrInvalidAgentCredential) {
		t.Fatalf("the revoked credential still reads: %v", err)
	}

	_, err = svc.AgentConnectionRevoke(ctx, connect.NewRequest(&userv1.AgentConnectionRevokeRequest{ConnectionId: mine.ID}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("revoking it twice = %v, want NotFound", err)
	}
}
