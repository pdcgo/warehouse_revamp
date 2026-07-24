package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
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

	if len(res.Msg.GetUsers()) != 1 || res.Msg.GetUsers()[0].GetUsername() != "in_team" {
		t.Fatalf("team-scoped list = %v, want exactly [in_team]", usernames(res.Msg.GetUsers()))
	}
}

func TestUserList_Search(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertUser(t, db, "alice", "pw12345678")
	insertUser(t, db, "bob", "pw12345678")

	res, err := svc.UserList(context.Background(), connect.NewRequest(&userv1.UserListRequest{
		Q:    "alic",
		Page: &commonPage,
	}))
	if err != nil {
		t.Fatalf("UserList: %v", err)
	}

	found := usernames(res.Msg.GetUsers())
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
