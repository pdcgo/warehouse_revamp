package user_v1_test

import (
	"context"
	"fmt"
	"testing"

	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// The test teams, by type. A grant is checked against its team's type, so the fake team_service must
// know them.
const (
	whTeam      uint64 = 9
	sellTeam    uint64 = 12
	adminTeam   uint64 = 20
	unknownTeam uint64 = 404
)

func testTeams() *fakeTeamClient {
	team := func(id uint64, kind teamv1.TeamType) *teamv1.Team {
		return &teamv1.Team{Id: id, Type: kind, Name: fmt.Sprintf("team %d", id)}
	}

	return &fakeTeamClient{byIds: map[uint64]*teamv1.Team{
		7:         team(7, teamv1.TeamType_TEAM_TYPE_WAREHOUSE),
		8:         team(8, teamv1.TeamType_TEAM_TYPE_WAREHOUSE),
		whTeam:    team(whTeam, teamv1.TeamType_TEAM_TYPE_WAREHOUSE),
		42:        team(42, teamv1.TeamType_TEAM_TYPE_WAREHOUSE),
		sellTeam:  team(sellTeam, teamv1.TeamType_TEAM_TYPE_SELLING),
		adminTeam: team(adminTeam, teamv1.TeamType_TEAM_TYPE_ADMIN),
	}}
}

// asRoot signs in as a Root — one per test transaction, made on first use.
func asRoot(t *testing.T, db *gorm.DB) context.Context {
	t.Helper()

	return asPlatform(t, db, "testroot", role_basev1.Role_ROLE_ROOT)
}

// asAdministrator signs in as the System Administrator.
func asAdministrator(t *testing.T, db *gorm.DB) context.Context {
	t.Helper()

	return asPlatform(t, db, "testadministrator", role_basev1.Role_ROLE_ADMINISTRATOR)
}

func asPlatform(t *testing.T, db *gorm.DB, username string, role role_basev1.Role) context.Context {
	t.Helper()

	var user user_service_models.User

	err := db.Where("username = ?", username).Limit(1).Find(&user).Error
	if err != nil {
		t.Fatalf("find %s: %v", username, err)
	}

	if user.ID == 0 {
		user.ID = insertUser(t, db, username, "platformpass1")
		grantRole(t, db, san_auth.RootTeamID, user.ID, role)
	}

	return ctxWithIdentity(user.ID, username)
}

// asMember makes a new person holding `role` in `teamID` and signs in as them.
func asMember(t *testing.T, db *gorm.DB, username string, teamID uint64, role role_basev1.Role) (context.Context, uint64) {
	t.Helper()

	id := memberOf(t, db, username, teamID, role)

	return ctxWithIdentity(id, username), id
}

// memberOf makes a new person holding `role` in `teamID`.
func memberOf(t *testing.T, db *gorm.DB, username string, teamID uint64, role role_basev1.Role) uint64 {
	t.Helper()

	id := insertUser(t, db, username, "memberpass1")
	grantRole(t, db, teamID, id, role)

	return id
}

// roleOf reads a person's role in a team (UNSPECIFIED = not a member).
func roleOf(t *testing.T, db *gorm.DB, teamID, userID uint64) role_basev1.Role {
	t.Helper()

	var rows []user_service_models.UserTeamRole

	err := db.Where("team_id = ? AND user_id = ?", teamID, userID).Limit(1).Find(&rows).Error
	if err != nil {
		t.Fatalf("read membership: %v", err)
	}

	if len(rows) == 0 {
		return role_basev1.Role_ROLE_UNSPECIFIED
	}

	return role_basev1.Role(rows[0].Role)
}

// identityIn reads back the signed-in user id.
func identityIn(t *testing.T, ctx context.Context) uint64 {
	t.Helper()

	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		t.Fatalf("no identity: %v", err)
	}

	return identity.GetIdentityId()
}
