//go:build perfaudit

// Performance audit for ShopUserSetPrimary (the audit-rpc-performance skill), on the shop seed in
// shop_access_check_perf_test.go.
//
//	go test -tags perfaudit -run TestPerf_ShopUserSetPrimary -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestPerf_ShopUserSetPrimary(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	shops := perfSeedShops(t, db)
	svc := newService(t, db)
	ctx := t.Context()

	setPrimary := func(teamID, shopID, userID uint64) (*connect.Response[sellingv1.ShopUserSetPrimaryResponse], error) {
		return svc.ShopUserSetPrimary(ctx, connect.NewRequest(&sellingv1.ShopUserSetPrimaryRequest{
			TeamId: teamID, ShopId: shopID, UserId: userID,
		}))
	}

	// Warm-up on another shop (team 7's shop 0, index 35: live, granted users k=0..4).
	warm := shops[perfShopIndex(7, 0)]

	_, err := setPrimary(warm.TeamID, warm.ID, perfShopUser(7, 1))
	if err != nil {
		t.Fatalf("ShopUserSetPrimary warm-up: %v", err)
	}

	// Team 1 234's shop 2 — index 6 172: grants k=2..6, primary k=2. Every run MOVES the flag, between
	// k=3 and k=4, so each one clears a primary and sets another (never the idempotent no-op).
	const team, j = 1_234, 2

	shop := shops[perfShopIndex(team, j)]
	teamID := perfShopTeamBase + team
	users := []uint64{perfShopUser(team, j+1), perfShopUser(team, j+2)}

	walls := make([]time.Duration, 0, 5)

	for run := range 5 {
		probe.Reset()

		user := users[run%2]

		var resp *connect.Response[sellingv1.ShopUserSetPrimaryResponse]

		wall, dbTime := probe.Measure(func() {
			resp, err = setPrimary(teamID, shop.ID, user)
		})
		if err != nil {
			t.Fatalf("ShopUserSetPrimary: %v", err)
		}

		if resp.Msg.GetShop().GetPrimaryUserId() != user {
			t.Fatalf("primary = %d, want %d", resp.Msg.GetShop().GetPrimaryUserId(), user)
		}

		walls = append(walls, wall)
		t.Logf("wall=%v db=%v go=%v queries=%d (statements, the SAVEPOINT aside: %d)",
			wall, dbTime, wall-dbTime, probe.Count(), perfStatements(probe.Queries()))
	}

	t.Logf("MEDIAN wall %v", san_perf.Median(walls))
	probe.Report(t, "ShopUserSetPrimary")

	// shop_users is a growing table — EXPLAIN every statement.
	perfExplainAll(t, db, probe.Queries())
}
