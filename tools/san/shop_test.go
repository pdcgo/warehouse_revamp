package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// newRolloutSan is the tool as `shop grant-current-cs` gets it — user_service, team_service and selling_service — on the
// test transaction. The resolver skips the cache, so a role seeded here is the role the grant's check reads.
func newRolloutSan(t *testing.T, db *gorm.DB) *San {
	t.Helper()

	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())
	users := user_v1.NewService(db, san_auth.NewSigner("test-secret", time.Hour), resolver, nil, nil,
		san_caches.NewSkipCacheManager(), event_source.EmptySender)

	return &San{db: db, users: users, teams: NewTeamCodes(db), shops: NewShopGrants(db, resolver), target: "test"}
}

// rolloutMember writes a person with a role in a team, as user_service stores it.
func rolloutMember(t *testing.T, db *gorm.DB, username string, teamID uint64, role role_basev1.Role, suspended bool) uint64 {
	t.Helper()

	user := user_service_models.User{Name: username, Username: username, Email: username + "@rollout.local", IsSuspended: suspended}

	err := db.Create(&user).Error
	if err != nil {
		t.Fatalf("seed user %s: %v", username, err)
	}

	err = db.Create(&user_service_models.UserTeamRole{TeamID: teamID, UserID: user.ID, Role: int32(role)}).Error
	if err != nil {
		t.Fatalf("seed role of %s: %v", username, err)
	}

	return user.ID
}

// rolloutShop writes a shop of a team, as selling_service stores it — open, or closed (a-shop-is-closed-never-deleted).
func rolloutShop(t *testing.T, db *gorm.DB, teamID uint64, code string, closed bool) uint64 {
	t.Helper()

	shop := selling_service_models.Shop{TeamID: teamID, Name: "Toko " + code, ShopCode: code, Marketplace: "shopee"}

	if closed {
		closedAt := time.Now()
		shop.Status = selling_service_models.ShopClosed
		shop.ClosedAt = &closedAt
	}

	err := db.Create(&shop).Error
	if err != nil {
		t.Fatalf("seed shop %s: %v", code, err)
	}

	return shop.ID
}

// grantsOf is the shop's grants as user id → primary.
func grantsOf(t *testing.T, db *gorm.DB, shopID uint64) map[uint64]bool {
	t.Helper()

	var rows []selling_service_models.ShopUser

	err := db.
		Where("shop_id = ?", shopID).
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("grants of shop %d: %v", shopID, err)
	}

	out := map[uint64]bool{}
	for _, row := range rows {
		out[row.UserID] = row.IsPrimary
	}

	return out
}

func countGrants(t *testing.T, db *gorm.DB) int64 {
	t.Helper()

	var n int64

	err := db.
		Model(&selling_service_models.ShopUser{}).
		Count(&n).
		Error
	if err != nil {
		t.Fatalf("count grants: %v", err)
	}

	return n
}

// THE ROLLOUT GRANT (a-write-needs-a-grant-or-a-manager): every current CS of a selling team gets every live shop of
// their team — not an owner or admin (they write without one), not a suspended CS, not a closed shop, not another
// team's shop, not a deleted team's. An existing grant and an existing primary are left alone; a shop with no primary
// gets the first CS granted. --dry-run writes nothing and reports the same; a second run adds nothing.
func TestGrantCurrentCS_GrantsEveryCurrentCSEveryLiveShopOfTheirTeam(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()
	san := newRolloutSan(t, db)

	teamA := seedTeam(t, db, "selling", "RLA")
	teamB := seedTeam(t, db, "selling", "RLB")
	warehouse := seedTeam(t, db, "warehouse", "RLW")

	gone := team_service_models.Team{Type: "selling", Name: "RLD", TeamCode: "RLD", Deleted: true}

	err := db.Create(&gone).Error
	if err != nil {
		t.Fatalf("seed deleted team: %v", err)
	}

	csA1 := rolloutMember(t, db, "rl_cs_a1", teamA, role_basev1.Role_ROLE_SELLING_CS, false)
	csA2 := rolloutMember(t, db, "rl_cs_a2", teamA, role_basev1.Role_ROLE_SELLING_CS, false)
	owner := rolloutMember(t, db, "rl_owner_a", teamA, role_basev1.Role_ROLE_SELLING_OWNER, false)
	admin := rolloutMember(t, db, "rl_admin_a", teamA, role_basev1.Role_ROLE_SELLING_ADMIN, false)
	suspended := rolloutMember(t, db, "rl_cs_a_susp", teamA, role_basev1.Role_ROLE_SELLING_CS, true)
	csB1 := rolloutMember(t, db, "rl_cs_b1", teamB, role_basev1.Role_ROLE_SELLING_CS, false)
	staff := rolloutMember(t, db, "rl_staff_w", warehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF, false)
	csGone := rolloutMember(t, db, "rl_cs_d", gone.ID, role_basev1.Role_ROLE_SELLING_CS, false)

	shopA1 := rolloutShop(t, db, teamA, "RLA-1", false)
	shopA2 := rolloutShop(t, db, teamA, "RLA-2", false)
	shopA3 := rolloutShop(t, db, teamA, "RLA-3", true)
	shopB1 := rolloutShop(t, db, teamB, "RLB-1", false)
	shopD1 := rolloutShop(t, db, gone.ID, "RLD-1", false)

	// A1 already has csA1, as its primary — the rollout must keep both.
	err = db.Create(&selling_service_models.ShopUser{ShopID: shopA1, UserID: csA1, IsPrimary: true}).Error
	if err != nil {
		t.Fatalf("seed existing grant: %v", err)
	}

	want := RolloutReport{Teams: 2, CSUsers: 3, Shops: 3, Added: 4, Skipped: 1, Primaries: 2}

	// DRY RUN — the same report, nothing written.
	var dry bytes.Buffer

	report, err := san.GrantCurrentCS(ctx, true, &dry)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}

	if report != want {
		t.Fatalf("dry run reported %+v, want %+v\n%s", report, want, dry.String())
	}

	if n := countGrants(t, db); n != 1 {
		t.Fatalf("dry run wrote grants: %d rows, want the 1 seeded\n%s", n, dry.String())
	}

	if !strings.Contains(dry.String(), "would grant rl_cs_a1") || strings.Contains(dry.String(), "  granted ") {
		t.Fatalf("dry run's lines should say what WOULD be granted:\n%s", dry.String())
	}

	// THE REAL RUN.
	var real bytes.Buffer

	report, err = san.GrantCurrentCS(ctx, false, &real)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if report != want {
		t.Fatalf("run reported %+v, want %+v\n%s", report, want, real.String())
	}

	if dryLines, realLines := strings.ReplaceAll(dry.String(), "would grant", "granted"), real.String(); dryLines != realLines {
		t.Fatalf("the dry run predicted\n%s\nbut the run did\n%s", dryLines, realLines)
	}

	expect := map[uint64]map[uint64]bool{
		shopA1: {csA1: true, csA2: false}, // the existing primary kept, csA2 added beside it
		shopA2: {csA1: true, csA2: false}, // no primary before: the lowest-id CS granted becomes it
		shopA3: {},                        // closed — nobody is granted it
		shopB1: {csB1: true},              // team B's CS only — never team A's
		shopD1: {},                        // a deleted team's shop — its team is not walked
	}

	for shopID, grants := range expect {
		got := grantsOf(t, db, shopID)
		if len(got) != len(grants) {
			t.Fatalf("shop %d grants %v, want %v", shopID, got, grants)
		}

		for userID, primary := range grants {
			isPrimary, ok := got[userID]
			if !ok || isPrimary != primary {
				t.Fatalf("shop %d grants %v, want %v", shopID, got, grants)
			}
		}
	}

	for _, nobody := range []uint64{owner, admin, suspended, staff, csGone} {
		var n int64

		err = db.
			Model(&selling_service_models.ShopUser{}).
			Where("user_id = ?", nobody).
			Count(&n).
			Error
		if err != nil {
			t.Fatalf("count grants of %d: %v", nobody, err)
		}

		if n != 0 {
			t.Fatalf("user %d got %d grants — owners, admins, suspended CS, other team types and deleted teams get none", nobody, n)
		}
	}

	// IDEMPOTENT — a second run adds nothing and skips all five.
	report, err = san.GrantCurrentCS(ctx, false, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("second run: %v", err)
	}

	again := RolloutReport{Teams: 2, CSUsers: 3, Shops: 3, Added: 0, Skipped: 5, Primaries: 0}
	if report != again {
		t.Fatalf("second run reported %+v, want %+v", report, again)
	}

	if n := countGrants(t, db); n != 5 {
		t.Fatalf("after two runs %d grants, want 5", n)
	}
}

// A DATABASE WITHOUT THE SCHEMA IS REFUSED — a wrong --dsn must not "succeed" with 0 teams and read as a rollout done.
// The table is renamed inside the test's transaction, so the rollback restores it.
func TestGrantCurrentCS_RefusesADatabaseWithoutTheSchema(t *testing.T) {
	db := san_testdb.DB(t)

	err := db.Exec("ALTER TABLE shop_users RENAME TO shop_users_hidden").Error
	if err != nil {
		t.Fatalf("hide shop_users: %v", err)
	}

	_, err = newRolloutSan(t, db).GrantCurrentCS(context.Background(), true, &bytes.Buffer{})
	if !errors.Is(err, errRolloutUnmigrated) {
		t.Fatalf("got %v, want errRolloutUnmigrated", err)
	}
}
