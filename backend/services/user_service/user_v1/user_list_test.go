package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestUserList_ScopedToTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := insertUser(t, db, "in_team", "pw12345678")
	insertUser(t, db, "not_in_team", "pw12345678")
	grantRole(t, db, 77, a, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	res, err := svc.UserList(context.Background(), connect.NewRequest(&userv1.UserListRequest{
		TeamId: 77,
		Page:   &commonPage,
	}))
	if err != nil {
		t.Fatalf("UserList: %v", err)
	}

	rows := userRows(res.Msg)
	if len(rows) != 1 || rows[0].GetUsername() != "in_team" {
		t.Fatalf("team-scoped list = %v, want exactly [in_team]", usernames(rows))
	}
}

func TestUserList_Search(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertUser(t, db, "alice", "pw12345678")
	insertUser(t, db, "bob", "pw12345678")

	res, err := svc.UserList(context.Background(), connect.NewRequest(&userv1.UserListRequest{
		Filter: &userv1.UserListFilter{Q: "alic"},
		Page:   &commonPage,
	}))
	if err != nil {
		t.Fatalf("UserList: %v", err)
	}

	found := usernames(userRows(res.Msg))
	if !contains(found, "alice") || contains(found, "bob") {
		t.Fatalf("search 'alic' = %v, want alice only", found)
	}
}

func usernames(users []*userv1.User) []string {
	out := make([]string, 0, len(users))
	for _, u := range users {
		out = append(out, u.GetUsername())
	}

	return out
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}

	return false
}

// The MEMBERSHIP slice: each member's role in the scoped team — what the Users screen's role column shows, and
// what tells its row actions an Owner from Staff.
func TestUserList_MembershipIsTheRoleInTheTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	owner := insertUser(t, db, "teamowner", "pw12345678")
	staff := insertUser(t, db, "teamstaff", "pw12345678")
	grantRole(t, db, 77, owner, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
	grantRole(t, db, 77, staff, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	grantRole(t, db, 78, staff, role_basev1.Role_ROLE_WAREHOUSE_ADMIN) // another team: must not leak in

	res, err := svc.UserList(context.Background(), connect.NewRequest(&userv1.UserListRequest{
		TeamId:      77,
		DataRequest: []userv1.UserListDataType{userv1.UserListDataType_USER_LIST_DATA_TYPE_USER, userv1.UserListDataType_USER_LIST_DATA_TYPE_MEMBERSHIP},
		Page:        &commonPage,
	}))
	if err != nil {
		t.Fatalf("UserList: %v", err)
	}

	roles := membershipRoles(res.Msg)

	if roles[owner] != role_basev1.Role_ROLE_WAREHOUSE_OWNER || roles[staff] != role_basev1.Role_ROLE_WAREHOUSE_STAFF {
		t.Fatalf("roles = %v, want the owner as WAREHOUSE_OWNER and staff as WAREHOUSE_STAFF, in team 77", roles)
	}
}

// At team_id = 0 (every user) the slice is the ROOT-TEAM role: a platform role for Root and the Administrator,
// and nothing at all for everyone else.
func TestUserList_MembershipAtTeamZeroIsTheRootTeamRole(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	admin := insertUser(t, db, "platformadmin", "pw12345678")
	plain := insertUser(t, db, "plainperson", "pw12345678")
	grantRole(t, db, san_auth.RootTeamID, admin, role_basev1.Role_ROLE_ADMINISTRATOR)
	grantRole(t, db, 77, plain, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	res, err := svc.UserList(context.Background(), connect.NewRequest(&userv1.UserListRequest{
		DataRequest: []userv1.UserListDataType{userv1.UserListDataType_USER_LIST_DATA_TYPE_MEMBERSHIP},
		Filter:      &userv1.UserListFilter{Q: "pla"}, // both usernames, and few others
		Page:        &commonPage,
	}))
	if err != nil {
		t.Fatalf("UserList: %v", err)
	}

	roles := membershipRoles(res.Msg)

	if roles[admin] != role_basev1.Role_ROLE_ADMINISTRATOR {
		t.Errorf("the Administrator's role = %v, want ADMINISTRATOR", roles[admin])
	}

	if role, found := roles[plain]; found {
		t.Errorf("a person with no root-team role has one in the slice: %v", role)
	}
}

func membershipRoles(res *userv1.UserListResponse) map[uint64]role_basev1.Role {
	roles := map[uint64]role_basev1.Role{}

	for _, item := range res.GetItems() {
		for id, m := range item.GetMembership().GetMapData() {
			roles[id] = m.GetRole()
		}
	}

	return roles
}
