package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestUpdateUser_ChangesName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "renameme", "pw12345678")

	res, err := svc.UpdateUser(context.Background(), connect.NewRequest(&userv1.UpdateUserRequest{
		UserId: uid,
		Name:   proto.String("New Name"),
	}))
	if err != nil {
		t.Fatalf("UpdateUser: %v", err)
	}

	if res.Msg.GetUser().GetName() != "New Name" {
		t.Errorf("name = %q, want New Name", res.Msg.GetUser().GetName())
	}
}

// A partial update must not blank the fields it did not send — email survives a name-only edit.
func TestUpdateUser_PartialDoesNotBlankEmail(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "keepmail", "pw12345678")

	res, err := svc.UpdateUser(context.Background(), connect.NewRequest(&userv1.UpdateUserRequest{
		UserId: uid,
		Name:   proto.String("Only Name"),
	}))
	if err != nil {
		t.Fatalf("UpdateUser: %v", err)
	}

	if res.Msg.GetUser().GetEmail() != "keepmail@x.local" {
		t.Errorf("email = %q, want it preserved", res.Msg.GetUser().GetEmail())
	}
}

func TestUpdateUser_MissingIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.UpdateUser(context.Background(), connect.NewRequest(&userv1.UpdateUserRequest{
		UserId: 9_999_999,
		Name:   proto.String("ghost"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// the-username-is-editable — a typo is fixed in place: same id, new name, and the new name signs in.
func TestUpdateUser_TheUsernameIsEditable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "anii", "pw12345678")
	fixed := "ani"

	res, err := svc.UpdateUser(context.Background(), connect.NewRequest(&userv1.UpdateUserRequest{UserId: uid, Username: &fixed}))
	if err != nil {
		t.Fatalf("UpdateUser: %v", err)
	}

	if res.Msg.GetUser().GetId() != uid || res.Msg.GetUser().GetUsername() != "ani" {
		t.Fatalf("got id %d username %q, want id %d username ani", res.Msg.GetUser().GetId(), res.Msg.GetUser().GetUsername(), uid)
	}

	_, err = newAuthService(t, db).Login(context.Background(), connect.NewRequest(&userv1.LoginRequest{Username: "ani", Password: "pw12345678"}))
	if err != nil {
		t.Fatalf("signing in with the new username: %v", err)
	}
}

// A username already taken is refused, as at create — and reported as a name, not an email.
func TestUpdateUser_ATakenUsernameIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertUser(t, db, "budi", "pw12345678")
	uid := insertUser(t, db, "budii", "pw12345678")
	taken := "budi"

	_, err := svc.UpdateUser(context.Background(), connect.NewRequest(&userv1.UpdateUserRequest{UserId: uid, Username: &taken}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// User 1 keeps `root`.
func TestUpdateUser_UserOneKeepsRoot(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	renamed := "notroot"

	_, err := svc.UpdateUser(context.Background(), connect.NewRequest(&userv1.UpdateUserRequest{UserId: 1, Username: &renamed}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}
