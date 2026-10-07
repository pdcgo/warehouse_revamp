package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Logout is public and reads the Authorization header itself (no identity in ctx). It must not
// fail even with a missing or junk token — logging out is always allowed.
func TestLogout_WithBearerSucceeds(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	uid := insertUser(t, db, "logoutuser", "pw12345678")
	token := mintToken(t, uid, "logoutuser")

	req := connect.NewRequest(&userv1.LogoutRequest{})
	req.Header().Set("Authorization", "Bearer "+token)

	_, err := auth.Logout(context.Background(), req)
	if err != nil {
		t.Fatalf("Logout: %v", err)
	}
}

func TestLogout_WithoutTokenSucceeds(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	_, err := auth.Logout(context.Background(), connect.NewRequest(&userv1.LogoutRequest{}))
	if err != nil {
		t.Fatalf("Logout with no token must still succeed, got: %v", err)
	}
}
