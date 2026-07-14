package user_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// mintToken signs a token for a user id the way Login would.
func mintToken(t *testing.T, uid uint64, username string) string {
	t.Helper()

	token, err := testSigner().Sign(&role_basev1.Identity{IdentityId: uid, Username: username}, time.Now())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	return token
}

func TestCheckAccess_ValidTokenRenews(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	uid := insertUser(t, db, "checkok", "pw12345678")
	token := mintToken(t, uid, "checkok")

	res, err := auth.CheckAccess(context.Background(), connect.NewRequest(&userv1.CheckAccessRequest{Token: token}))
	if err != nil {
		t.Fatalf("CheckAccess: %v", err)
	}

	if res.Msg.GetIdentity().GetIdentityId() != uid {
		t.Errorf("identity id = %d, want %d", res.Msg.GetIdentity().GetIdentityId(), uid)
	}

	// A renewed token is returned (sliding session).
	if res.Msg.GetToken() == "" {
		t.Error("expected a renewed token")
	}
}

func TestCheckAccess_SuspendedRefused(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	uid := insertUser(t, db, "checksusp", "pw12345678")
	token := mintToken(t, uid, "checksusp")
	db.Model(&user_service_models.User{}).Where("id = ?", uid).Update("is_suspended", true)

	_, err := auth.CheckAccess(context.Background(), connect.NewRequest(&userv1.CheckAccessRequest{Token: token}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied — a suspension must bite on renewal too", connect.CodeOf(err))
	}
}

func TestCheckAccess_GarbageTokenRejected(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	_, err := auth.CheckAccess(context.Background(), connect.NewRequest(&userv1.CheckAccessRequest{Token: "not-a-token"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}
