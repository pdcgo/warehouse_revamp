package main

import (
	"context"
	"testing"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// liability's team seam reads team_service's TeamByIds in-process: a known team answers its name — and, for the pair
// list's search and kind filter (backlog #34), its code and type — while an unknown or deleted one is absent, which a
// search then never matches. More ids than one TeamByIds call takes are asked in batches, none dropped.
func TestLiabilityTeamNamer_ReadsNamesAndFactsFromTeamService(t *testing.T) {
	db := san_testdb.DB(t)

	live := team_service_models.Team{Type: "warehouse", Name: "Gudang Kenanga", TeamCode: "GKN"}
	gone := team_service_models.Team{Type: "selling", Name: "Toko Hilang", TeamCode: "THX", Deleted: true}

	for _, team := range []*team_service_models.Team{&live, &gone} {
		err := db.Create(team).Error
		if err != nil {
			t.Fatalf("seed team: %v", err)
		}
	}

	namer := NewLiabilityTeamNamer(team_v1.NewService(db, nil))
	ctx := context.Background()

	// 250 ids — past TeamByIds' 200 — with the live team LAST, so it is answered from the second batch.
	ids := make([]uint64, 0, 250)
	for i := uint64(0); i < 249; i++ {
		ids = append(ids, 9_000_000+i)
	}

	ids = append(ids, gone.ID, live.ID)

	names, err := namer.TeamNames(ctx, ids)
	if err != nil {
		t.Fatalf("TeamNames: %v", err)
	}

	if len(names) != 1 || names[live.ID] != "Gudang Kenanga" {
		t.Fatalf("names = %v, want only the live team", names)
	}

	facts, err := namer.TeamFacts(ctx, ids)
	if err != nil {
		t.Fatalf("TeamFacts: %v", err)
	}

	got, ok := facts[live.ID]
	if len(facts) != 1 || !ok {
		t.Fatalf("facts = %v, want only the live team", facts)
	}

	if got.Name != "Gudang Kenanga" || got.Code != "GKN" || got.Type != teamv1.TeamType_TEAM_TYPE_WAREHOUSE {
		t.Fatalf("fact = %+v, want Gudang Kenanga / GKN / warehouse", got)
	}

	// No ids, no question.
	empty, err := namer.TeamFacts(ctx, nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("TeamFacts(nil) = %v, %v", empty, err)
	}
}
