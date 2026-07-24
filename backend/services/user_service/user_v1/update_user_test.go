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
