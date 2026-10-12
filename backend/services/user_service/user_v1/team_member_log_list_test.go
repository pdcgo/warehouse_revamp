package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// every-role-change-is-logged: an add, a role change and a removal each write ONE row, in the transaction of the
// change, newest first in the list.
func TestTeamMemberLogList_EveryChangeIsARow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	owner, ownerID := asMember(t, db, "logowner", whTeam, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
	ani := insertUser(t, db, "logani", "pw12345678")

	steps := []*connect.Request[userv1.TeamUserUpdateRequest]{
		add(whTeam, ani, role_basev1.Role_ROLE_WAREHOUSE_STAFF),
		add(whTeam, ani, role_basev1.Role_ROLE_WAREHOUSE_ADMIN),
		remove(whTeam, ani),
	}

	for _, step := range steps {
		_, err := svc.TeamUserUpdate(owner, step)
		if err != nil {
			t.Fatalf("TeamUserUpdate: %v", err)
		}
	}

	entries := memberLog(t, svc, owner, whTeam, ani)
	if len(entries) != 3 {
		t.Fatalf("rows = %d, want 3 (add, change, remove)", len(entries))
	}

	want := []struct {
		action        userv1.TeamMemberLogAction
		before, after role_basev1.Role
	}{
		// Newest first.
		{userv1.TeamMemberLogAction_TEAM_MEMBER_LOG_ACTION_REMOVE, role_basev1.Role_ROLE_WAREHOUSE_ADMIN, role_basev1.Role_ROLE_UNSPECIFIED},
		{userv1.TeamMemberLogAction_TEAM_MEMBER_LOG_ACTION_CHANGE_ROLE, role_basev1.Role_ROLE_WAREHOUSE_STAFF, role_basev1.Role_ROLE_WAREHOUSE_ADMIN},
		{userv1.TeamMemberLogAction_TEAM_MEMBER_LOG_ACTION_ADD, role_basev1.Role_ROLE_UNSPECIFIED, role_basev1.Role_ROLE_WAREHOUSE_STAFF},
	}

	for i, w := range want {
		e := entries[i]
		if e.GetAction() != w.action || e.GetRoleBefore() != w.before || e.GetRoleAfter() != w.after {
			t.Errorf("row %d = %v %v→%v, want %v %v→%v", i, e.GetAction(), e.GetRoleBefore(), e.GetRoleAfter(), w.action, w.before, w.after)
		}

		if e.GetActorUserId() != ownerID || e.GetUserId() != ani || e.GetTeamId() != whTeam {
			t.Errorf("row %d: actor %d user %d team %d, want the owner on Ani in team %d", i, e.GetActorUserId(), e.GetUserId(), e.GetTeamId(), whTeam)
		}

		if e.GetIsOverride() {
			t.Errorf("row %d: a member acting in their own team is not an override", i)
		}
	}
}

// Nothing changing writes nothing: a retried grant of the role a person already holds, and a refused change.
func TestTeamMemberLogList_NoChangeNoRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	owner, _ := asMember(t, db, "nochangeowner", whTeam, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
	ani := memberOf(t, db, "nochangeani", whTeam, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	other := insertUser(t, db, "nochangeother", "pw12345678")

	_, err := svc.TeamUserUpdate(owner, add(whTeam, ani, role_basev1.Role_ROLE_WAREHOUSE_STAFF))
	if err != nil {
		t.Fatalf("re-granting the same role: %v", err)
	}

	// An Owner never makes another Owner — refused, so its transaction and its log row roll back together.
	_, err = svc.TeamUserUpdate(owner, add(whTeam, other, role_basev1.Role_ROLE_WAREHOUSE_OWNER))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", connect.CodeOf(err))
	}

	if entries := memberLog(t, svc, owner, whTeam, 0); len(entries) != 0 {
		t.Fatalf("rows = %d, want none — nothing changed", len(entries))
	}
}

// an-override-is-stamped-in-every-service: Root acting in a team it holds no role in is marked an override, and
// CreateUser's membership is logged like any other add.
func TestTeamMemberLogList_RootOutsideTheTeamIsAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	root := asRoot(t, db)

	res, err := svc.CreateUser(root, connect.NewRequest(&userv1.CreateUserRequest{
		TeamId:   sellTeam,
		Username: "overrideadded",
		Password: "pw12345678",
		Name:     "Override Added",
		Role:     role_basev1.Role_ROLE_SELLING_CS,
	}))
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	entries := memberLog(t, svc, root, sellTeam, res.Msg.GetUser().GetId())
	if len(entries) != 1 {
		t.Fatalf("rows = %d, want 1 — CreateUser adds a membership", len(entries))
	}

	e := entries[0]
	if e.GetAction() != userv1.TeamMemberLogAction_TEAM_MEMBER_LOG_ACTION_ADD || e.GetRoleAfter() != role_basev1.Role_ROLE_SELLING_CS {
		t.Errorf("row = %v →%v, want an ADD as SELLING_CS", e.GetAction(), e.GetRoleAfter())
	}

	if !e.GetIsOverride() || e.GetActorUserId() != identityIn(t, root) {
		t.Errorf("override = %v, actor = %d — want Root, marked an override", e.GetIsOverride(), e.GetActorUserId())
	}
}

// The filter narrows to one person; another team's rows never appear.
func TestTeamMemberLogList_FiltersToOnePersonInOneTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	root := asRoot(t, db)
	ani := insertUser(t, db, "filterani", "pw12345678")
	budi := insertUser(t, db, "filterbudi", "pw12345678")

	for _, step := range []*connect.Request[userv1.TeamUserUpdateRequest]{
		add(whTeam, ani, role_basev1.Role_ROLE_WAREHOUSE_STAFF),
		add(whTeam, budi, role_basev1.Role_ROLE_WAREHOUSE_STAFF),
		add(sellTeam, ani, role_basev1.Role_ROLE_SELLING_CS),
	} {
		_, err := svc.TeamUserUpdate(root, step)
		if err != nil {
			t.Fatalf("TeamUserUpdate: %v", err)
		}
	}

	if n := len(memberLog(t, svc, root, whTeam, 0)); n != 2 {
		t.Errorf("the warehouse's rows = %d, want 2 (Ani and Budi, not Ani's selling team)", n)
	}

	only := memberLog(t, svc, root, whTeam, ani)
	if len(only) != 1 || only[0].GetUserId() != ani {
		t.Errorf("Ani's rows in the warehouse = %d, want exactly hers", len(only))
	}
}

func memberLog(t *testing.T, svc *user_v1.Service, ctx context.Context, teamID, userID uint64) []*userv1.TeamMemberLogEntry {
	t.Helper()

	res, err := svc.TeamMemberLogList(ctx, connect.NewRequest(&userv1.TeamMemberLogListRequest{
		TeamId: teamID,
		Filter: &userv1.TeamMemberLogListFilter{UserId: userID},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("TeamMemberLogList: %v", err)
	}

	byID := map[uint64]*userv1.TeamMemberLogEntry{}
	for _, item := range res.Msg.GetItems() {
		for id, e := range item.GetEntry().GetMapData() {
			byID[id] = e
		}
	}

	out := make([]*userv1.TeamMemberLogEntry, 0, len(res.Msg.GetIds()))
	for _, id := range res.Msg.GetIds() {
		out = append(out, byID[id])
	}

	return out
}
