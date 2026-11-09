package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// THE OWNER REVOKES A MEMBER'S CONNECTION — but not one reading another team, nor root's every-team one.
func TestAgentConnectionTeamRevoke(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)

	owner := insertUser(t, db, "owner", "pw")
	cs := insertUser(t, db, "cs", "pw")

	members := connectAgent(t, store, clientID, cs, 5, "cs's")
	elsewhere := connectAgent(t, store, clientID, cs, 6, "another team")
	roots := connectAgent(t, store, clientID, 1, 0, "root's every team")

	ctx := ctxWithIdentity(owner, "owner")

	for _, id := range []uint64{elsewhere.ID, roots.ID} {
		_, err := svc.AgentConnectionTeamRevoke(ctx, connect.NewRequest(&userv1.AgentConnectionTeamRevokeRequest{TeamId: 5, ConnectionId: id}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("team 5's owner revoking connection %d = %v, want NotFound", id, err)
		}
	}

	_, err := svc.AgentConnectionTeamRevoke(ctx, connect.NewRequest(&userv1.AgentConnectionTeamRevokeRequest{TeamId: 5, ConnectionId: members.ID}))
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}

	var row user_service_models.AgentCredential
	db.First(&row, members.ID)

	if row.RevokedAt == nil {
		t.Fatal("the member's connection was not revoked")
	}
}
