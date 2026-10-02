//go:build perfaudit

// Performance audit for ShopAccessCheck (the audit-rpc-performance skill), and the shop seed the
// ShopUserAdd / ShopUserSetPrimary audits share.
//
//	go test -tags perfaudit -run TestPerf_ShopAccessCheck -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The shop volume the shop-access audits seed: 10 000 shops (an entity table) — 2 000 selling teams
// with a handful each — and ~49 000 grants, five per shop from the team's eight users.
const (
	perfShopTeamBase  uint64 = 10_000 // team ids start here, clear of the unit tests' teams
	perfShopTeamCount        = 2_000
	perfShopsPerTeam         = 5
	perfGrantsPerShop        = 5
	perfShopUserBase  uint64 = 500_000
)

// perfShopIndex is a shop's position in the seed: team t's j-th shop.
func perfShopIndex(team, j int) int {
	return team*perfShopsPerTeam + j
}

// perfShopUser is the k-th of team t's users. k 0..7 hold grants; 8 and 9 hold none.
func perfShopUser(team, k int) uint64 {
	return perfShopUserBase + uint64(team)*10 + uint64(k)
}

// perfSeedShops seeds the shops and their grants, and returns the shops (ids filled) in seed order.
//
// By the shop's index i:
//
//	i%20 == 19  soft-deleted (5%)
//	i%50 == 49  no grants yet — nobody has been given it (2%)
//	i%10 == 3   five grants, its primary's grant since removed — no primary (10%)
//	otherwise   five grants, the first one — user (j+0)%8 — primary
func perfSeedShops(t *testing.T, db *gorm.DB) []selling_service_models.Shop {
	t.Helper()

	markets := []string{"shopee", "tiktok", "lazada", "tokopedia", "shopee"}

	shops := make([]selling_service_models.Shop, 0, perfShopTeamCount*perfShopsPerTeam)

	for team := range perfShopTeamCount {
		for j := range perfShopsPerTeam {
			i := perfShopIndex(team, j)

			shops = append(shops, selling_service_models.Shop{
				TeamID:      perfShopTeamBase + uint64(team),
				Name:        fmt.Sprintf("Toko %d-%d", team, j),
				ShopCode:    fmt.Sprintf("PERF-%d-%d", team, j),
				Marketplace: markets[j],
				Deleted:     i%20 == 19,
			})
		}
	}

	san_perf.SeedRows(t, db, shops)

	grants := make([]selling_service_models.ShopUser, 0, len(shops)*perfGrantsPerShop)

	for i := range shops {
		if i%50 == 49 {
			continue
		}

		team, j := i/perfShopsPerTeam, i%perfShopsPerTeam

		for g := range perfGrantsPerShop {
			grants = append(grants, selling_service_models.ShopUser{
				ShopID:    shops[i].ID,
				UserID:    perfShopUser(team, (j+g)%8),
				IsPrimary: g == 0 && i%10 != 3,
			})
		}
	}

	san_perf.SeedRows(t, db, grants)

	t.Logf("seeded %d shops, %d grants", len(shops), len(grants))

	return shops
}

// perfStatements is the probe's count minus the SAVEPOINT the per-test transaction substitutes for a
// write handler's BEGIN — a statement production never sends (and BEGIN/COMMIT are never logged).
func perfStatements(qs []san_perf.Query) int {
	n := 0

	for _, q := range qs {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") {
			continue
		}

		n++
	}

	return n
}

// perfExplainAll EXPLAINs every statement of the last measured call, each inside a savepoint that is
// rolled back — EXPLAIN ANALYZE of an UPDATE runs it, and one plan must not change the next one's rows.
func perfExplainAll(t *testing.T, db *gorm.DB, qs []san_perf.Query) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	for _, q := range qs {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") {
			continue
		}

		err := quiet.Exec("SAVEPOINT perf_explain").Error
		if err != nil {
			t.Fatalf("savepoint: %v", err)
		}

		san_perf.Explain(t, quiet, q.SQL)

		err = quiet.Exec("ROLLBACK TO SAVEPOINT perf_explain").Error
		if err != nil {
			t.Fatalf("rollback to savepoint: %v", err)
		}
	}
}

func TestPerf_ShopAccessCheck(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	shops := perfSeedShops(t, db)

	// Team 1 234's shop 2 — index 6 172: live, granted, and its primary is user k=2.
	const team, j = 1_234, 2

	shop := shops[perfShopIndex(team, j)]
	teamID := perfShopTeamBase + team
	primary := perfShopUser(team, j)
	granted := perfShopUser(team, j+1) // a granted CS, not the primary
	owner := perfShopUser(team, 9)     // no grant — the team's owner, answered by the role reader

	svc := newServiceWithRoles(t, db, fakeRoles{{owner, teamID}: role_basev1.Role_ROLE_TEAM_OWNER})
	ctx := t.Context()

	// Warm-up on another shop: schema reflection and pool setup are not this RPC's cost.
	warm := shops[perfShopIndex(7, 0)]

	_, err := svc.ShopAccessCheck(ctx, connect.NewRequest(&sellingv1.ShopAccessCheckRequest{
		TeamId: warm.TeamID, ShopId: warm.ID, UserId: perfShopUser(7, 1),
	}))
	if err != nil {
		t.Fatalf("ShopAccessCheck warm-up: %v", err)
	}

	for _, tc := range []struct {
		name string
		user uint64
	}{
		{"a granted CS", granted},
		{"the team's owner, no grant", owner},
	} {
		req := &sellingv1.ShopAccessCheckRequest{TeamId: teamID, ShopId: shop.ID, UserId: tc.user}
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			var resp *connect.Response[sellingv1.ShopAccessCheckResponse]

			wall, dbTime := probe.Measure(func() {
				resp, err = svc.ShopAccessCheck(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("ShopAccessCheck (%s): %v", tc.name, err)
			}

			if !resp.Msg.GetIsHaveAccess() || resp.Msg.GetPrimaryUserId() != primary {
				t.Fatalf("%s: access %v primary %d, want true / %d",
					tc.name, resp.Msg.GetIsHaveAccess(), resp.Msg.GetPrimaryUserId(), primary)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", tc.name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", tc.name, san_perf.Median(walls))
		probe.Report(t, "ShopAccessCheck — "+tc.name)

		// Both queries read a growing table (shop_users) or an entity table — EXPLAIN each.
		perfExplainAll(t, db, probe.Queries())
	}
}
