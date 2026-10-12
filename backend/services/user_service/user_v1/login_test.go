package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func TestLogin_Succeeds(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	insertUser(t, db, "loginok", "correct-pw-1")

	res, err := auth.Login(context.Background(), connect.NewRequest(&userv1.LoginRequest{
		Username: "loginok",
		Password: "correct-pw-1",
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	if res.Msg.GetToken() == "" || res.Msg.GetIdentity().GetUsername() != "loginok" {
		t.Fatalf("login returned token=%q identity=%v", res.Msg.GetToken(), res.Msg.GetIdentity())
	}
}

// A wrong password and an unknown user must return the SAME error — otherwise login is a
// username oracle.
func TestLogin_NoAccountEnumeration(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	insertUser(t, db, "realuser", "correct-pw-1")

	_, wrongErr := auth.Login(context.Background(), connect.NewRequest(&userv1.LoginRequest{
		Username: "realuser", Password: "wrong",
	}))
	_, unknownErr := auth.Login(context.Background(), connect.NewRequest(&userv1.LoginRequest{
		Username: "ghost", Password: "wrong",
	}))

	if connect.CodeOf(wrongErr) != connect.CodeUnauthenticated || connect.CodeOf(unknownErr) != connect.CodeUnauthenticated {
		t.Fatalf("codes: wrong=%v unknown=%v, want both Unauthenticated", connect.CodeOf(wrongErr), connect.CodeOf(unknownErr))
	}

	if wrongErr.Error() != unknownErr.Error() {
		t.Errorf("wrong-password and unknown-user errors differ:\n  %q\n  %q", wrongErr.Error(), unknownErr.Error())
	}
}

func TestLogin_SuspendedRefused(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	uid := insertUser(t, db, "susplogin", "correct-pw-1")
	db.Model(&user_service_models.User{}).Where("id = ?", uid).Update("is_suspended", true)

	_, err := auth.Login(context.Background(), connect.NewRequest(&userv1.LoginRequest{
		Username: "susplogin", Password: "correct-pw-1",
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied for a suspended account", connect.CodeOf(err))
	}
}
