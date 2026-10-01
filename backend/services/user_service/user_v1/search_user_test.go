package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestSearchUser_FindsByUsername(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertUser(t, db, "charlie", "pw12345678")
	insertUser(t, db, "diana", "pw12345678")

	res, err := svc.SearchUser(context.Background(), connect.NewRequest(&userv1.SearchUserRequest{
		Q:     "char",
		Limit: 10,
	}))
	if err != nil {
		t.Fatalf("SearchUser: %v", err)
	}

	users := res.Msg.GetUsers()
	if len(users) != 1 || users[0].GetUsername() != "charlie" {
		t.Fatalf("search 'char' returned %d users, want charlie only", len(users))
	}
}

func TestSearchUser_RespectsLimit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, n := range []string{"team_a", "team_b", "team_c"} {
		insertUser(t, db, n, "pw12345678")
	}

	res, err := svc.SearchUser(context.Background(), connect.NewRequest(&userv1.SearchUserRequest{
		Q:     "team_",
		Limit: 2,
	}))
	if err != nil {
		t.Fatalf("SearchUser: %v", err)
	}

	if len(res.Msg.GetUsers()) != 2 {
		t.Fatalf("limit 2 returned %d users", len(res.Msg.GetUsers()))
	}
}
