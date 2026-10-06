package user_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
	"gorm.io/gorm"
)

// newService builds a user_v1.Service against the test tx, with a fake team_service that knows the
// test teams' TYPES: a grant is checked against its team's type (every-role-has-a-code-name).
func newService(t *testing.T, db *gorm.DB) *user_v1.Service {
	t.Helper()

	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	return user_v1.NewService(
		db,
		san_auth.NewSigner("test-secret", time.Hour),
		resolver,
		testTeams(),
		&fakePhotos{},
		san_caches.NewSkipCacheManager(),
	)
}

func TestCreateUser_InsideTeam_WritesUserAndMembership(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	res, err := svc.CreateUser(asRoot(t, db), connect.NewRequest(&userv1.CreateUserRequest{
		TeamId:   42,
		Username: "picker",
		Password: "pickerpass1",
		Name:     "Picker",
		Role:     role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}))
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	uid := res.Msg.GetUser().GetId()

	// The membership must exist in the SAME row-set — user + membership are one transaction.
	var count int64

	err = db.
		Model(&user_service_models.UserTeamRole{}).
		Where("user_id = ? AND team_id = ? AND role = ?", uid, 42, role_basev1.Role_ROLE_WAREHOUSE_STAFF).
		Count(&count).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if count != 1 {
		t.Fatalf("membership rows = %d, want 1", count)
	}
}

func TestCreateUser_Teamless_NoMembership(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	res, err := svc.CreateUser(asRoot(t, db), connect.NewRequest(&userv1.CreateUserRequest{
		TeamId:   0, // teamless — root/admin only in practice; here we just verify no membership
		Username: "loner",
		Password: "lonerpass1",
	}))
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	var count int64
	db.Model(&user_service_models.UserTeamRole{}).Where("user_id = ?", res.Msg.GetUser().GetId()).Count(&count)

	if count != 0 {
		t.Errorf("teamless user has %d memberships, want 0", count)
	}
}

func TestCreateUser_DuplicateUsername_AlreadyExists(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := func() *connect.Request[userv1.CreateUserRequest] {
		return connect.NewRequest(&userv1.CreateUserRequest{TeamId: 42, Username: "dup", Password: "duppass123", Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF})
	}

	_, err := svc.CreateUser(asRoot(t, db), req())
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.CreateUser(asRoot(t, db), req())
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("second create code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// The duplicate must not leave a half-written user: the whole create is one transaction.
func TestCreateUser_DuplicateIsAtomic(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, _ = svc.CreateUser(asRoot(t, db), connect.NewRequest(&userv1.CreateUserRequest{
		TeamId: 7, Username: "atomic", Password: "atomicpass1", Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}))

	// Second attempt collides on username but names a DIFFERENT team. If the insert order leaked,
	// we might see a stray membership for team 8. It must not.
	_, _ = svc.CreateUser(asRoot(t, db), connect.NewRequest(&userv1.CreateUserRequest{
		TeamId: 8, Username: "atomic", Password: "atomicpass1", Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}))

	var strays int64
	db.Model(&user_service_models.UserTeamRole{}).Where("team_id = ?", 8).Count(&strays)

	if strays != 0 {
		t.Errorf("found %d membership rows for the failed create's team — the transaction leaked", strays)
	}
}

// ROOT/ADMIN are meaningful only in the root team; granting them elsewhere is refused.
func TestCreateUser_GlobalRoleOutsideRoot_Rejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.CreateUser(asRoot(t, db), connect.NewRequest(&userv1.CreateUserRequest{
		TeamId: 42, Username: "fakeadmin", Password: "fakeadmin1", Role: role_basev1.Role_ROLE_ADMINISTRATOR,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument for ADMIN outside the root team", connect.CodeOf(err))
	}
}

// A new user's role is a grant: an Owner never creates another Owner
// (an-owner-never-makes-another-owner), and the refused create leaves no account behind.
func TestCreateUser_TheRoleIsAGrant(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	owner, _ := asMember(t, db, "sellowner", sellTeam, role_basev1.Role_ROLE_SELLING_OWNER)

	_, err := svc.CreateUser(owner, connect.NewRequest(&userv1.CreateUserRequest{
		TeamId: sellTeam, Username: "secondowner", Password: "ownerpass1", Name: "Second", Role: role_basev1.Role_ROLE_SELLING_OWNER,
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", connect.CodeOf(err))
	}

	var count int64
	db.Model(&user_service_models.User{}).Where("username = ?", "secondowner").Count(&count)

	if count != 0 {
		t.Fatalf("a refused create left %d account(s)", count)
	}

	_, err = svc.CreateUser(owner, connect.NewRequest(&userv1.CreateUserRequest{
		TeamId: sellTeam, Username: "newcs", Password: "cspassword1", Name: "New CS", Role: role_basev1.Role_ROLE_SELLING_CS,
	}))
	if err != nil {
		t.Fatalf("an Owner creating Customer Service: %v", err)
	}
}
