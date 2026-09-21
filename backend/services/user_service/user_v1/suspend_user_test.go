package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func TestSuspendUser_SetsFlag(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "tosuspend", "pw12345678")

	_, err := svc.SuspendUser(context.Background(), connect.NewRequest(&userv1.SuspendUserRequest{
		UserId:    uid,
		Suspended: true,
	}))
	if err != nil {
		t.Fatalf("SuspendUser: %v", err)
	}

	var user user_service_models.User
	db.First(&user, uid)

	if !user.IsSuspended {
		t.Error("is_suspended = false, want true")
	}
}

// The root account is the only guaranteed super-admin; suspending it would lock the system out
// of itself.
func TestSuspendUser_RootRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.SuspendUser(context.Background(), connect.NewRequest(&userv1.SuspendUserRequest{
		UserId:    1,
		Suspended: true,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument for suspending root", connect.CodeOf(err))
	}
}
