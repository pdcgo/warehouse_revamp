package user_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_verification"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// testSecret is the JWT secret shared by every service built in tests, so a token minted by
// Login round-trips through CheckAccess.
const testSecret = "test-secret"

func testSigner() *san_auth.Signer {
	return san_auth.NewSigner(testSecret, time.Hour)
}

// newAuthService builds the AuthService against the test tx, with the OTP mock (accepts
// san_verification.MockOtpCode).
func newAuthService(t *testing.T, db *gorm.DB) *user_v1.AuthService {
	t.Helper()

	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	return user_v1.NewAuthService(db, testSigner(), resolver, san_verification.NewMockOtpVerification())
}

// newServiceWithTeams is like newService but with a supplied team client, for TeamAccessList.
func newServiceWithTeams(t *testing.T, db *gorm.DB, teams *fakeTeamClient) *user_v1.Service {
	t.Helper()

	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	return user_v1.NewService(db, testSigner(), resolver, teams, san_caches.NewSkipCacheManager())
}

// insertUser inserts a user with a bcrypt-hashed password and returns its id.
func insertUser(t *testing.T, db *gorm.DB, username, password string) uint64 {
	t.Helper()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}

	u := user_service_models.User{Username: username, Email: username + "@x.local", Password: string(hash)}

	err = db.Create(&u).Error
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	return u.ID
}

// grantRole inserts a membership.
func grantRole(t *testing.T, db *gorm.DB, teamID, userID uint64, role role_basev1.Role) {
	t.Helper()

	err := db.Create(&user_service_models.UserTeamRole{TeamID: teamID, UserID: userID, Role: int32(role)}).Error
	if err != nil {
		t.Fatalf("insert membership: %v", err)
	}
}

// ctxWithIdentity puts an authenticated identity in ctx, as the interceptor would — for the
// handlers whose subject is the token holder (UpdateProfile, ResetPassword, RoleResolve, …).
func ctxWithIdentity(userID uint64, username string) context.Context {
	return san_auth.WithIdentity(context.Background(), &role_basev1.Identity{
		IdentityId: userID,
		Username:   username,
	})
}

// fakeTeamClient is a stand-in team_service. Only TeamByIds is exercised (by TeamAccessList);
// the rest satisfy the interface. Its TeamByIds returns whatever `byIds` holds — or an empty
// map, which drives the degrade-to-blank-name path.
type fakeTeamClient struct {
	byIds map[uint64]*teamv1.Team
}

func (f *fakeTeamClient) TeamByIds(_ context.Context, _ *connect.Request[teamv1.TeamByIdsRequest]) (*connect.Response[teamv1.TeamByIdsResponse], error) {
	data := f.byIds
	if data == nil {
		data = map[uint64]*teamv1.Team{}
	}

	return connect.NewResponse(&teamv1.TeamByIdsResponse{Data: data}), nil
}

func (f *fakeTeamClient) TeamCreate(context.Context, *connect.Request[teamv1.TeamCreateRequest]) (*connect.Response[teamv1.TeamCreateResponse], error) {
	return nil, nil
}
func (f *fakeTeamClient) TeamUpdate(context.Context, *connect.Request[teamv1.TeamUpdateRequest]) (*connect.Response[teamv1.TeamUpdateResponse], error) {
	return nil, nil
}
func (f *fakeTeamClient) TeamDelete(context.Context, *connect.Request[teamv1.TeamDeleteRequest]) (*connect.Response[teamv1.TeamDeleteResponse], error) {
	return nil, nil
}
func (f *fakeTeamClient) TeamList(context.Context, *connect.Request[teamv1.TeamListRequest]) (*connect.Response[teamv1.TeamListResponse], error) {
	return nil, nil
}
func (f *fakeTeamClient) TeamDetail(context.Context, *connect.Request[teamv1.TeamDetailRequest]) (*connect.Response[teamv1.TeamDetailResponse], error) {
	return nil, nil
}
func (f *fakeTeamClient) TeamInfoUpdate(context.Context, *connect.Request[teamv1.TeamInfoUpdateRequest]) (*connect.Response[teamv1.TeamInfoUpdateResponse], error) {
	return nil, nil
}
