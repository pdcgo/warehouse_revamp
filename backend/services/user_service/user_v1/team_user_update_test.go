package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func TestTeamUserUpdate_AddThenRemove(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "member", "pw12345678")

	// Add.
	_, err := svc.TeamUserUpdate(asRoot(t, db), connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: 9,
		Action: &userv1.TeamUserUpdateRequest_Add{
			Add: &userv1.AddTeamUser{UserId: uid, Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF},
		},
	}))
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	var count int64
	db.Model(&user_service_models.UserTeamRole{}).Where("team_id = ? AND user_id = ?", 9, uid).Count(&count)
	if count != 1 {
		t.Fatalf("after add, membership rows = %d, want 1", count)
	}

	// Remove.
	_, err = svc.TeamUserUpdate(asRoot(t, db), connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: 9,
		Action: &userv1.TeamUserUpdateRequest_Remove{Remove: &userv1.RemoveTeamUser{UserId: uid}},
	}))
	if err != nil {
		t.Fatalf("remove: %v", err)
	}

	db.Model(&user_service_models.UserTeamRole{}).Where("team_id = ? AND user_id = ?", 9, uid).Count(&count)
	if count != 0 {
		t.Fatalf("after remove, membership rows = %d, want 0", count)
	}
}

// Adding a user that does not exist is NotFound, not a dangling membership row.
func TestTeamUserUpdate_AddNonexistentUser(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.TeamUserUpdate(asRoot(t, db), connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: 9,
		Action: &userv1.TeamUserUpdateRequest_Add{
			Add: &userv1.AddTeamUser{UserId: 9_999_999, Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF},
		},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// add and remove build the two TeamUserUpdate requests the tests below send.
func add(teamID, userID uint64, role role_basev1.Role) *connect.Request[userv1.TeamUserUpdateRequest] {
	return connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: teamID,
		Action: &userv1.TeamUserUpdateRequest_Add{Add: &userv1.AddTeamUser{UserId: userID, Role: role}},
	})
}

func remove(teamID, userID uint64) *connect.Request[userv1.TeamUserUpdateRequest] {
	return connect.NewRequest(&userv1.TeamUserUpdateRequest{
		TeamId: teamID,
		Action: &userv1.TeamUserUpdateRequest_Remove{Remove: &userv1.RemoveTeamUser{UserId: userID}},
	})
}

// an-owner-never-makes-another-owner — refused, and nothing is written.
func TestTeamUserUpdate_AnOwnerNeverMakesAnotherOwner(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	owner, _ := asMember(t, db, "whowner", whTeam, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
	newcomer := insertUser(t, db, "newcomer", "pw12345678")

	_, err := svc.TeamUserUpdate(owner, add(whTeam, newcomer, role_basev1.Role_ROLE_WAREHOUSE_OWNER))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", connect.CodeOf(err))
	}

	if got := roleOf(t, db, whTeam, newcomer); got != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Fatalf("the refused grant was written: %s", got)
	}

	// Below the Owner is fine.
	_, err = svc.TeamUserUpdate(owner, add(whTeam, newcomer, role_basev1.Role_ROLE_WAREHOUSE_ADMIN))
	if err != nil {
		t.Fatalf("an Owner making an Admin: %v", err)
	}
}

// change-role-only-below-your-own — an Admin removes Staff, never the Owner.
func TestTeamUserUpdate_AnAdminActsOnlyBelowThemselves(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	admin, _ := asMember(t, db, "whadmin", whTeam, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)
	owner := memberOf(t, db, "theowner", whTeam, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
	staff := memberOf(t, db, "thestaff", whTeam, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	_, err := svc.TeamUserUpdate(admin, remove(whTeam, owner))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("removing the Owner: code = %v, want PermissionDenied", connect.CodeOf(err))
	}

	_, err = svc.TeamUserUpdate(admin, add(whTeam, owner, role_basev1.Role_ROLE_WAREHOUSE_STAFF))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("demoting the Owner: code = %v, want PermissionDenied", connect.CodeOf(err))
	}

	if got := roleOf(t, db, whTeam, owner); got != role_basev1.Role_ROLE_WAREHOUSE_OWNER {
		t.Fatalf("the Owner is now %s", got)
	}

	_, err = svc.TeamUserUpdate(admin, remove(whTeam, staff))
	if err != nil {
		t.Fatalf("an Admin removing Staff: %v", err)
	}

	if got := roleOf(t, db, whTeam, staff); got != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Fatalf("Staff is still %s", got)
	}
}

// every-role-has-a-code-name — a role belongs to its team's type, whoever gives it.
func TestTeamUserUpdate_ARoleBelongsToItsTeamType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "anyone", "pw12345678")

	_, err := svc.TeamUserUpdate(asRoot(t, db), add(whTeam, uid, role_basev1.Role_ROLE_ADMIN_OWNER))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an admin-team role in a warehouse team: code = %v, want InvalidArgument", connect.CodeOf(err))
	}

	_, err = svc.TeamUserUpdate(asRoot(t, db), add(adminTeam, uid, role_basev1.Role_ROLE_ADMIN_OWNER))
	if err != nil {
		t.Fatalf("an admin-team role in the admin team: %v", err)
	}
}

// A grant must not go through on a team type that could not be checked.
func TestTeamUserUpdate_AnUncheckableTeamIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "anyone", "pw12345678")

	_, err := svc.TeamUserUpdate(asRoot(t, db), add(unknownTeam, uid, role_basev1.Role_ROLE_WAREHOUSE_STAFF))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// Root and the Administrator may add THEMSELVES to a team they are not in — the Create Team form may
// name them as its Owner — and nobody may change a membership they already hold.
func TestTeamUserUpdate_SelfOnlyToJoin(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	root := asRoot(t, db)
	rootID := identityIn(t, root)

	_, err := svc.TeamUserUpdate(root, add(sellTeam, rootID, role_basev1.Role_ROLE_SELLING_OWNER))
	if err != nil {
		t.Fatalf("Root joining a new team as its Owner: %v", err)
	}

	_, err = svc.TeamUserUpdate(root, remove(sellTeam, rootID))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("Root removing their own membership: code = %v, want PermissionDenied", connect.CodeOf(err))
	}
}

// a-suspended-user-is-never-picked: a suspended user cannot be newly given anything, so they are never
// added to a team — not even by Root, and not as a new team's first Owner (TeamCreate grants through
// here). Refused before anything is written, so team_service can free the team's code.
func TestTeamUserUpdate_ASuspendedUserIsNeverAdded(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "suspended", "pw12345678")
	markSuspended(t, db, uid)

	_, err := svc.TeamUserUpdate(asRoot(t, db), add(sellTeam, uid, role_basev1.Role_ROLE_SELLING_OWNER))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if role := roleOf(t, db, sellTeam, uid); role != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Errorf("a refused add wrote a membership: %v", role)
	}
}

// Suspension is not a new grant: a suspended MEMBER keeps their place and may still be changed.
func TestTeamUserUpdate_ASuspendedMemberMayStillBeChanged(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := memberOf(t, db, "suspendedstaff", whTeam, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	markSuspended(t, db, uid)

	_, err := svc.TeamUserUpdate(asRoot(t, db), add(whTeam, uid, role_basev1.Role_ROLE_WAREHOUSE_ADMIN))
	if err != nil {
		t.Fatalf("changing a suspended member's role: %v", err)
	}

	if role := roleOf(t, db, whTeam, uid); role != role_basev1.Role_ROLE_WAREHOUSE_ADMIN {
		t.Errorf("role = %v, want WAREHOUSE_ADMIN", role)
	}
}

func markSuspended(t *testing.T, db *gorm.DB, userID uint64) {
	t.Helper()

	err := db.Model(&user_service_models.User{}).Where("id = ?", userID).Update("is_suspended", true).Error
	if err != nil {
		t.Fatalf("suspend: %v", err)
	}
}
