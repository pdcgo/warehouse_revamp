package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func suspend(userID uint64) *connect.Request[userv1.SuspendUserRequest] {
	return connect.NewRequest(&userv1.SuspendUserRequest{UserId: userID, Suspended: true})
}

func TestSuspendUser_SetsFlag(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "tosuspend", "pw12345678")

	_, err := svc.SuspendUser(asRoot(t, db), suspend(uid))
	if err != nil {
		t.Fatalf("SuspendUser: %v", err)
	}

	var user user_service_models.User
	db.First(&user, uid)

	if !user.IsSuspended {
		t.Error("is_suspended = false, want true")
	}
}

// only-root-and-the-administrator-suspend — a Root is judged by ROLE, so a second Root is as safe as
// user 1, and not even another Root may suspend one.
func TestSuspendUser_ARootIsNeverSuspended(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	secondRoot := memberOf(t, db, "secondroot", san_auth.RootTeamID, role_basev1.Role_ROLE_ROOT)

	_, err := svc.SuspendUser(asRoot(t, db), suspend(secondRoot))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", connect.CodeOf(err))
	}
}

// Only Root suspends an Administrator; the Administrator suspends anyone below.
func TestSuspendUser_OnlyRootSuspendsAnAdministrator(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	other := memberOf(t, db, "otheradministrator", san_auth.RootTeamID, role_basev1.Role_ROLE_ADMINISTRATOR)
	staff := memberOf(t, db, "somestaff", whTeam, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	_, err := svc.SuspendUser(asAdministrator(t, db), suspend(other))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("the Administrator suspending an Administrator: code = %v, want PermissionDenied", connect.CodeOf(err))
	}

	_, err = svc.SuspendUser(asAdministrator(t, db), suspend(staff))
	if err != nil {
		t.Fatalf("the Administrator suspending Staff: %v", err)
	}

	_, err = svc.SuspendUser(asRoot(t, db), suspend(other))
	if err != nil {
		t.Fatalf("Root suspending an Administrator: %v", err)
	}
}

// Nobody suspends themselves.
func TestSuspendUser_NotYourself(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	administrator := asAdministrator(t, db)

	_, err := svc.SuspendUser(administrator, suspend(identityIn(t, administrator)))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", connect.CodeOf(err))
	}
}
