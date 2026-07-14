package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// UserTeams returns the given user (as a PublicUser) plus their memberships, resolving team NAMES
// over RPC. With a team client that answers, names come through.
func TestUserTeams_ReturnsUserAndTeams(t *testing.T) {
	db := san_testdb.DB(t)

	teams := &fakeTeamClient{byIds: map[uint64]*teamv1.Team{
		3: {Id: 3, Name: "Team Three", Type: teamv1.TeamType_TEAM_TYPE_WAREHOUSE},
		4: {Id: 4, Name: "Team Four"},
	}}
	svc := newServiceWithTeams(t, db, teams)

	uid := insertUser(t, db, "viewed", "pw12345678")
	grantRole(t, db, 3, uid, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	grantRole(t, db, 4, uid, role_basev1.Role_ROLE_TEAM_OWNER)

	// The interceptor gates this by policy; the handler itself takes the user id from the request.
	res, err := svc.UserTeams(ctxWithIdentity(1, "root"), connect.NewRequest(&userv1.UserTeamsRequest{UserId: uid}))
	if err != nil {
		t.Fatalf("UserTeams: %v", err)
	}

	if res.Msg.GetUser().GetId() != uid {
		t.Fatalf("user id = %d, want %d", res.Msg.GetUser().GetId(), uid)
	}

	if res.Msg.GetUser().GetUsername() != "viewed" {
		t.Errorf("username = %q, want viewed", res.Msg.GetUser().GetUsername())
	}

	if len(res.Msg.GetTeams()) != 2 {
		t.Fatalf("teams = %d, want 2", len(res.Msg.GetTeams()))
	}

	roles := map[uint64]role_basev1.Role{}
	names := map[uint64]string{}
	for _, item := range res.Msg.GetTeams() {
		roles[item.GetTeamId()] = item.GetRole()
		names[item.GetTeamId()] = item.GetTeamName()
	}

	if roles[3] != role_basev1.Role_ROLE_WAREHOUSE_STAFF || roles[4] != role_basev1.Role_ROLE_TEAM_OWNER {
		t.Errorf("roles = %v, want 3=WAREHOUSE_STAFF 4=TEAM_OWNER", roles)
	}

	if names[3] != "Team Three" || names[4] != "Team Four" {
		t.Errorf("resolved names = %v, want 3=Team Three 4=Team Four", names)
	}
}

// When team_service is unreachable (the fake returns an empty map) the memberships still come back
// — with blank names. Viewing a user's teams must not depend on team_service being up.
func TestUserTeams_DegradesWhenTeamsMissing(t *testing.T) {
	db := san_testdb.DB(t)

	svc := newServiceWithTeams(t, db, &fakeTeamClient{}) // empty map
	uid := insertUser(t, db, "viewed2", "pw12345678")
	grantRole(t, db, 3, uid, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	res, err := svc.UserTeams(ctxWithIdentity(1, "root"), connect.NewRequest(&userv1.UserTeamsRequest{UserId: uid}))
	if err != nil {
		t.Fatalf("UserTeams must not fail when names are unavailable: %v", err)
	}

	if len(res.Msg.GetTeams()) != 1 {
		t.Fatalf("teams = %d, want 1 (membership still returned)", len(res.Msg.GetTeams()))
	}

	item := res.Msg.GetTeams()[0]

	if item.GetTeamId() != 3 || item.GetRole() != role_basev1.Role_ROLE_WAREHOUSE_STAFF {
		t.Errorf("membership = (team %d, role %v), want (3, WAREHOUSE_STAFF)", item.GetTeamId(), item.GetRole())
	}

	if item.GetTeamName() != "" {
		t.Errorf("team_name = %q, want empty (degraded)", item.GetTeamName())
	}
}

// A user with no memberships resolves to an empty (non-nil) list — the detail view's empty state.
func TestUserTeams_NoMemberships(t *testing.T) {
	db := san_testdb.DB(t)

	svc := newServiceWithTeams(t, db, &fakeTeamClient{})
	uid := insertUser(t, db, "loner", "pw12345678")

	res, err := svc.UserTeams(ctxWithIdentity(1, "root"), connect.NewRequest(&userv1.UserTeamsRequest{UserId: uid}))
	if err != nil {
		t.Fatalf("UserTeams: %v", err)
	}

	if len(res.Msg.GetTeams()) != 0 {
		t.Fatalf("teams = %d, want 0", len(res.Msg.GetTeams()))
	}
}

// An unknown user id is NotFound — not an empty result. The subject must exist.
func TestUserTeams_UnknownUserIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)

	svc := newServiceWithTeams(t, db, &fakeTeamClient{})

	_, err := svc.UserTeams(ctxWithIdentity(1, "root"), connect.NewRequest(&userv1.UserTeamsRequest{UserId: 999999}))
	if err == nil {
		t.Fatal("UserTeams(unknown id) = nil error, want NotFound")
	}

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
