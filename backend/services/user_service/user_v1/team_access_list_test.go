package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// TeamAccessList returns the caller's memberships (own table) and resolves team NAMES over RPC.
// With a team client that answers, names come through.
func TestTeamAccessList_ReturnsMembershipsWithNames(t *testing.T) {
	db := san_testdb.DB(t)

	teams := &fakeTeamClient{byIds: map[uint64]*teamv1.Team{
		3: {Id: 3, Name: "Team Three"},
		4: {Id: 4, Name: "Team Four"},
	}}
	svc := newServiceWithTeams(t, db, teams)

	uid := insertUser(t, db, "multi", "pw12345678")
	grantRole(t, db, 3, uid, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	grantRole(t, db, 4, uid, role_basev1.Role_ROLE_TEAM_OWNER)

	ctx := ctxWithIdentity(uid, "multi")

	// user_id = 0 means "me".
	res, err := svc.TeamAccessList(ctx, connect.NewRequest(&userv1.TeamAccessListRequest{}))
	if err != nil {
		t.Fatalf("TeamAccessList: %v", err)
	}

	if len(res.Msg.GetTeams()) != 2 {
		t.Fatalf("teams = %d, want 2", len(res.Msg.GetTeams()))
	}

	names := map[uint64]string{}
	for _, item := range res.Msg.GetTeams() {
		names[item.GetTeamId()] = item.GetTeamName()
	}

	if names[3] != "Team Three" || names[4] != "Team Four" {
		t.Errorf("resolved names = %v, want 3=Team Three 4=Team Four", names)
	}
}

// When team_service is unreachable (the fake returns nothing), the list still returns — with
// blank names. A name lookup must never be able to take down the session bootstrap.
func TestTeamAccessList_DegradesWhenTeamsMissing(t *testing.T) {
	db := san_testdb.DB(t)

	svc := newServiceWithTeams(t, db, &fakeTeamClient{}) // empty map
	uid := insertUser(t, db, "degrade", "pw12345678")
	grantRole(t, db, 3, uid, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	ctx := ctxWithIdentity(uid, "degrade")

	res, err := svc.TeamAccessList(ctx, connect.NewRequest(&userv1.TeamAccessListRequest{}))
	if err != nil {
		t.Fatalf("TeamAccessList must not fail when names are unavailable: %v", err)
	}

	if len(res.Msg.GetTeams()) != 1 {
		t.Fatalf("teams = %d, want 1 (membership still returned)", len(res.Msg.GetTeams()))
	}

	if res.Msg.GetTeams()[0].GetTeamName() != "" {
		t.Errorf("team_name = %q, want empty (degraded)", res.Msg.GetTeams()[0].GetTeamName())
	}
}
