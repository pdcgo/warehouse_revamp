package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func TestResetPassword_WrongOldRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "resetme", "correct-old-1")
	ctx := ctxWithIdentity(uid, "resetme")

	_, err := svc.ResetPassword(ctx, connect.NewRequest(&userv1.ResetPasswordRequest{
		OldPassword: "wrong",
		NewPassword: "new-password-1",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated for a wrong old password", connect.CodeOf(err))
	}
}

func TestResetPassword_CorrectReturnsTokenAndStampsReset(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "resetok", "correct-old-1")
	ctx := ctxWithIdentity(uid, "resetok")

	res, err := svc.ResetPassword(ctx, connect.NewRequest(&userv1.ResetPasswordRequest{
		OldPassword: "correct-old-1",
		NewPassword: "new-password-1",
	}))
	if err != nil {
		t.Fatalf("ResetPassword: %v", err)
	}

	// A fresh token is handed back, or the user would log themselves out by changing their
	// password.
	if res.Msg.GetToken() == "" {
		t.Error("expected a fresh token")
	}

	// last_password_reset is stamped — this is what kills every token minted before it.
	var user user_service_models.User
	db.First(&user, uid)

	if user.LastPasswordReset == nil {
		t.Error("last_password_reset was not stamped")
	}
}
