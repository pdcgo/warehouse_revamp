package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE OWNER SEES EVERY CONNECTION READING THE TEAM — a member's too — and none reading another team or every team.
func TestAgentConnectionTeamList(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)

	owner := insertUser(t, db, "owner", "pw")
	cs := insertUser(t, db, "cs", "pw")

	ownersOwn := connectAgent(t, store, clientID, owner, 5, "owner's")
	members := connectAgent(t, store, clientID, cs, 5, "cs's")
	connectAgent(t, store, clientID, cs, 6, "another team")
	connectAgent(t, store, clientID, 1, 0, "root's every team")

	res, err := svc.AgentConnectionTeamList(ctxWithIdentity(owner, "owner"), connect.NewRequest(&userv1.AgentConnectionTeamListRequest{
		TeamId: 5,
		Page:   pageAll(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	got := connectionsOf(res.Msg.GetItems(), res.Msg.GetIds())
	if len(got) != 2 || got[0].GetId() != members.ID || got[1].GetId() != ownersOwn.ID {
		t.Fatalf("listed %v, want [%d %d] — team 5's, newest first", res.Msg.GetIds(), members.ID, ownersOwn.ID)
	}

	if got[0].GetUserId() != cs {
		t.Fatalf("the member's connection names user %d, want %d", got[0].GetUserId(), cs)
	}
}
