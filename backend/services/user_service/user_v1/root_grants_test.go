package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func lastLog(t *testing.T, db *gorm.DB, userID uint64) user_service_models.TeamMemberLog {
	t.Helper()

	var row user_service_models.TeamMemberLog

	err := db.Where("team_id = ? AND user_id = ?", san_auth.RootTeamID, userID).Order("id DESC").First(&row).Error
	if err != nil {
		t.Fatalf("log row: %v", err)
	}

	return row
}

// root-can-be-several: san makes a second Root, the history names san, and doing it again changes nothing.
func TestGrantRoot_MakesARootAndLogsSan(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	fajar := insertUser(t, db, "fajar", "pw12345678")

	changed, err := svc.GrantRoot(ctx, fajar, "san")
	if err != nil || !changed {
		t.Fatalf("GrantRoot: changed=%v err=%v", changed, err)
	}

	if role := roleOf(t, db, san_auth.RootTeamID, fajar); role != role_basev1.Role_ROLE_ROOT {
		t.Fatalf("fajar is %s, want Root", role)
	}

	row := lastLog(t, db, fajar)
	if row.ActorAgent != "san" || row.ActorUserID != nil || row.IsOverride {
		t.Fatalf("log row actor %q / %v override %v, want san with no user", row.ActorAgent, row.ActorUserID, row.IsOverride)
	}

	changed, err = svc.GrantRoot(ctx, fajar, "san")
	if err != nil || changed {
		t.Fatalf("granting again: changed=%v err=%v, want a no-op", changed, err)
	}
}

// One role per team: the System Administrator made Root holds Root, and the history says it changed.
func TestGrantRoot_TheAdministratorBecomesRoot(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	gita := insertUser(t, db, "gita", "pw12345678")
	grantRole(t, db, san_auth.RootTeamID, gita, role_basev1.Role_ROLE_ADMINISTRATOR)

	_, err := svc.GrantRoot(context.Background(), gita, "san")
	if err != nil {
		t.Fatalf("GrantRoot: %v", err)
	}

	row := lastLog(t, db, gita)
	if role_basev1.Role(row.RoleBefore) != role_basev1.Role_ROLE_ADMINISTRATOR || role_basev1.Role(row.RoleAfter) != role_basev1.Role_ROLE_ROOT {
		t.Fatalf("logged %d → %d, want Administrator → Root", row.RoleBefore, row.RoleAfter)
	}
}

// a-suspended-user-is-never-picked: a suspended account is never made Root.
func TestGrantRoot_RefusesASuspendedAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	citra := insertUser(t, db, "citra", "pw12345678")
	db.Model(&user_service_models.User{}).Where("id = ?", citra).Update("is_suspended", true)

	_, err := svc.GrantRoot(context.Background(), citra, "san")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("GrantRoot of a suspended account: %v, want FailedPrecondition", err)
	}
}

// The last Root is never removed (Q20c); a second one can be, and the history names san.
func TestRevokeRoot_NeverTheLast(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	// Whoever holds Root in the root team now, other than the seeded user 1, is taken out first, so the test
	// starts from exactly one.
	db.Where("team_id = ? AND role = ? AND user_id <> 1", san_auth.RootTeamID, int32(role_basev1.Role_ROLE_ROOT)).
		Delete(&user_service_models.UserTeamRole{})

	err := svc.RevokeRoot(ctx, 1, "san")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("removing the only Root: %v, want refused", err)
	}

	fajar := insertUser(t, db, "fajar", "pw12345678")

	_, err = svc.GrantRoot(ctx, fajar, "san")
	if err != nil {
		t.Fatalf("GrantRoot: %v", err)
	}

	err = svc.RevokeRoot(ctx, fajar, "san")
	if err != nil {
		t.Fatalf("removing a second Root: %v", err)
	}

	if role := roleOf(t, db, san_auth.RootTeamID, fajar); role != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Fatalf("fajar still %s", role)
	}

	if row := lastLog(t, db, fajar); row.ActorAgent != "san" || role_basev1.Role(row.RoleAfter) != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Fatalf("logged %+v, want a removal by san", row)
	}

	// Not a Root at all.
	err = svc.RevokeRoot(ctx, fajar, "san")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("removing a non-Root: %v, want refused", err)
	}
}
