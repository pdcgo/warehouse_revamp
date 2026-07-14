package access_interceptors_test

import (
	"context"
	"testing"

	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// newUser inserts a user and returns its id. SkipCache is used everywhere so every Resolve hits
// the database — these tests exercise the QUERY, not the cache.
func newUser(t *testing.T, db *gorm.DB, username string, suspended bool) uint64 {
	t.Helper()

	u := user_service_models.User{Username: username, Email: username + "@x.local", IsSuspended: suspended}

	err := db.Create(&u).Error
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	return u.ID
}

func grant(t *testing.T, db *gorm.DB, teamID, userID uint64, role role_basev1.Role) {
	t.Helper()

	err := db.Create(&user_service_models.UserTeamRole{TeamID: teamID, UserID: userID, Role: int32(role)}).Error
	if err != nil {
		t.Fatalf("insert membership: %v", err)
	}
}

// THE critical invariant: a user who is not a member resolves to role 0, NOT an error.
//
// The resolver looks up the ROOT team on every request, and almost nobody is a member of it — so
// if "no row" were an error, every non-root request in the system would fail. This test would go
// red the instant someone "fixes" the query to use First instead of Find.
func TestResolve_NonMemberIsRoleZeroNotError(t *testing.T) {
	db := san_testdb.DB(t)
	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	uid := newUser(t, db, "nonmember", false)

	access, err := resolver.Resolve(context.Background(), uid, 999)
	if err != nil {
		t.Fatalf("Resolve must not error for a non-member: %v", err)
	}

	if access.Role != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Errorf("Role = %v, want UNSPECIFIED (0) for a non-member", access.Role)
	}

	if access.RootRole != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Errorf("RootRole = %v, want UNSPECIFIED", access.RootRole)
	}
}

func TestResolve_MemberRoleAndRootRole(t *testing.T) {
	db := san_testdb.DB(t)
	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	uid := newUser(t, db, "member", false)
	grant(t, db, 42, uid, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)
	grant(t, db, san_auth.RootTeamID, uid, role_basev1.Role_ROLE_ADMIN)

	access, err := resolver.Resolve(context.Background(), uid, 42)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	if access.Role != role_basev1.Role_ROLE_WAREHOUSE_ADMIN {
		t.Errorf("Role = %v, want WAREHOUSE_ADMIN", access.Role)
	}

	// The super-admin bypass is reported in the same call — no second round trip.
	if access.RootRole != role_basev1.Role_ROLE_ADMIN {
		t.Errorf("RootRole = %v, want ADMIN", access.RootRole)
	}
}

// Suspension must be reported on every resolve, or a suspended user's live token keeps working.
func TestResolve_SuspendedFlag(t *testing.T) {
	db := san_testdb.DB(t)
	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	uid := newUser(t, db, "suspended", true)
	grant(t, db, 42, uid, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	access, err := resolver.Resolve(context.Background(), uid, 42)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	if !access.Suspended {
		t.Error("Suspended = false, want true — a suspended member must be flagged")
	}
}

// A user id that does not exist must fail CLOSED: treated as suspended, so a deleted account's
// lingering token authorizes nothing.
func TestResolve_MissingUserFailsClosed(t *testing.T) {
	db := san_testdb.DB(t)
	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	access, err := resolver.Resolve(context.Background(), 9_999_999, 42)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	if !access.Suspended {
		t.Error("a nonexistent user must resolve as Suspended (fail closed)")
	}
}
