package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// returnMapsOf reads a team's maps of these borrowed products, flattened to borrowed id → own id.
func returnMapsOf(t *testing.T, svc *selling_v1.Service, teamID uint64, ids ...uint64) map[uint64]uint64 {
	t.Helper()

	res, err := svc.ProductReturnMapByIds(context.Background(), connect.NewRequest(&sellingv1.ProductReturnMapByIdsRequest{
		TeamId: teamID,
		Filter: &sellingv1.ProductReturnMapByIdsFilter{Ids: ids},
	}))
	if err != nil {
		t.Fatalf("by ids: %v", err)
	}

	out := map[uint64]uint64{}

	for id, list := range res.Msg.GetItems() {
		for _, item := range list.GetItems() {
			pair := item.GetPair().GetMapData()[id]
			if pair == nil {
				t.Fatalf("product %d's list carries no pair keyed by its own id", id)
			}

			if pair.GetSharedProductId() != id || pair.GetTeamId() != teamID {
				t.Fatalf("product %d answered with %+v", id, pair)
			}

			out[id] = pair.GetOwnProductId()
		}
	}

	return out
}

// The team's pairs come back keyed by the borrowed product; one it has not mapped is ABSENT — the row the form asks
// about.
func TestProductReturnMapByIds_ReturnsTheTeamsPairsAndOmitsTheUnmapped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)

	mapForReturns(t, svc, mapTeam, borrowedA, ourProduct)

	got := returnMapsOf(t, svc, mapTeam, borrowedA, borrowedB)

	if len(got) != 1 || got[borrowedA] != ourProduct {
		t.Fatalf("maps = %v, want only %d → %d (%d is unmapped)", got, borrowedA, ourProduct, borrowedB)
	}
}

// ⚠ ANOTHER TEAM'S MAP IS INVISIBLE. Team 3 mapped the same borrowed product; team 2 has not — so team 2 is told the
// product is unmapped, never handed team 3's answer.
func TestProductReturnMapByIds_AnotherTeamsPairIsNeverSeen(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)

	mapForReturns(t, svc, 3, borrowedA, 701)

	if got := returnMapsOf(t, svc, mapTeam, borrowedA); len(got) != 0 {
		t.Fatalf("team 2 read %v — team 3's map leaked across teams", got)
	}

	if got := returnMapsOf(t, svc, 3, borrowedA); got[borrowedA] != 701 {
		t.Fatalf("team 3 read %v, want its own %d → 701", got, borrowedA)
	}
}
