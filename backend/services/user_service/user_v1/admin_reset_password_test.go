package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// AdminResetPassword takes a user_id (no identity, no old password) — a different operation from
// the self-serve reset. It stamps last_password_reset so the target's existing tokens die.
func TestAdminResetPassword_SetsPasswordForAnother(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "victim", "their-old-1")

	_, err := svc.AdminResetPassword(context.Background(), connect.NewRequest(&userv1.AdminResetPasswordRequest{
		UserId:      uid,
		NewPassword: "admin-set-1",
	}))
	if err != nil {
		t.Fatalf("AdminResetPassword: %v", err)
	}

	var user user_service_models.User
	db.First(&user, uid)

	if user.LastPasswordReset == nil {
		t.Error("last_password_reset was not stamped — the target's tokens would survive")
	}
}

func TestAdminResetPassword_MissingIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.AdminResetPassword(context.Background(), connect.NewRequest(&userv1.AdminResetPasswordRequest{
		UserId:      9_999_999,
		NewPassword: "admin-set-1",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
