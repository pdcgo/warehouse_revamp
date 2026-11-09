package user_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// MY LIVE CONNECTIONS, newest first — never somebody else's, never a revoked one.
func TestAgentConnectionList(t *testing.T) {
	db := san_testdb.DB(t)
	svc, store := newAgentService(t, db)
	clientID := registerAgent(t, store)

	me := insertUser(t, db, "me", "pw")
	other := insertUser(t, db, "other", "pw")

	first := connectAgent(t, store, clientID, me, 5, "laptop")
	second := connectAgent(t, store, clientID, me, 6, "phone")
	revoked := connectAgent(t, store, clientID, me, 5, "old")
	connectAgent(t, store, clientID, other, 5, "theirs")

	db.Model(&user_service_models.AgentCredential{}).Where("id = ?", revoked.ID).Update("revoked_at", time.Now())

	res, err := svc.AgentConnectionList(ctxWithIdentity(me, "me"), connect.NewRequest(&userv1.AgentConnectionListRequest{Page: pageAll()}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	got := connectionsOf(res.Msg.GetItems(), res.Msg.GetIds())
	if len(got) != 2 || got[0].GetId() != second.ID || got[1].GetId() != first.ID {
		t.Fatalf("listed %v, want [%d %d] — mine, live, newest first", res.Msg.GetIds(), second.ID, first.ID)
	}

	if got[0].GetName() != "phone" || got[0].GetTeamId() != 6 || got[0].GetClientName() != "ChatGPT" || got[0].GetExpiresAtUnix() == 0 {
		t.Fatalf("connection = %+v, want its name, team, client and expiry", got[0])
	}

	if res.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total = %d, want 2", res.Msg.GetPageInfo().GetTotalItems())
	}
}
