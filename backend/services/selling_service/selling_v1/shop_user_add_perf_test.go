//go:build perfaudit

// Performance audit for ShopUserAdd (the audit-rpc-performance skill), on the shop seed in
// shop_access_check_perf_test.go — both paths: a new grant on a shop that has its primary, and the
// first grant on a shop nobody has been given, which becomes the primary.
//
//	go test -tags perfaudit -run TestPerf_ShopUserAdd -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestPerf_ShopUserAdd(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	shops := perfSeedShops(t, db)
	svc := newService(t, db)
	ctx := t.Context()

	add := func(teamID, shopID, userID uint64) error {
		_, err := svc.ShopUserAdd(ctx, connect.NewRequest(&sellingv1.ShopUserAddRequest{
			TeamId: teamID, ShopId: shopID, UserId: userID,
		}))

		return err
	}

	// Warm-up: a new grant on team 7's shop 0.
	warm := shops[perfShopIndex(7, 0)]

	err := add(warm.TeamID, warm.ID, perfShopUser(7, 8))
	if err != nil {
		t.Fatalf("ShopUserAdd warm-up: %v", err)
	}

	const team, j = 1_234, 2

	target := shops[perfShopIndex(team, j)]

	// Shops nobody has been given, still live: index ≡ 49 (mod 100) — see perfSeedShops.
	var ungranted []int
	for i := 49; len(ungranted) < 5; i += 100 {
		ungranted = append(ungranted, i)
	}

	for _, tc := range []struct {
		name string
		call func(run int) error
	}{
		{"a new grant on a shop that has its primary", func(run int) error {
			// k=0 and k=1 hold no grant on this shop, then users from outside the team's eight.
			return add(target.TeamID, target.ID, perfShopUser(team, 0)+uint64(run)*1_000_000)
		}},
		{"the first grant on a shop nobody has been given", func(run int) error {
			i := ungranted[run]

			return add(shops[i].TeamID, shops[i].ID, perfShopUser(i/perfShopsPerTeam, 0))
		}},
	} {
		walls := make([]time.Duration, 0, 5)

		for run := range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				err = tc.call(run)
			})
			if err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d (statements, the SAVEPOINT aside: %d)",
				tc.name, wall, dbTime, wall-dbTime, probe.Count(), perfStatements(probe.Queries()))
		}

		t.Logf("%s: MEDIAN wall %v", tc.name, san_perf.Median(walls))
		probe.Report(t, "ShopUserAdd — "+tc.name)

		// shop_users is a growing table — EXPLAIN every statement.
		perfExplainAll(t, db, probe.Queries())
	}
}
