package main

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// The admin team monitors WAREHOUSE and SELLING teams (the-admin-team-monitors-all-and-manages-its-own) — read off
// team_service's `teams.type`. The root team, an admin team and a team that does not exist are not monitored.
func TestTeamKinds_OnlyWarehouseAndSellingTeams(t *testing.T) {
	db := san_testdb.DB(t)
	kinds := NewTeamKinds(db)
	ctx := context.Background()

	ids := map[string]uint64{}

	for i, kind := range []string{"warehouse", "selling", "admin"} {
		team := team_service_models.Team{Type: kind, Name: "kinds " + kind, TeamCode: []string{"KW", "KS", "KA"}[i]}

		err := db.Create(&team).Error
		if err != nil {
			t.Fatalf("team %s: %v", kind, err)
		}

		ids[kind] = team.ID
	}

	for _, c := range []struct {
		name string
		id   uint64
		want bool
	}{
		{"a warehouse", ids["warehouse"], true},
		{"a selling team", ids["selling"], true},
		{"an admin team", ids["admin"], false},
		{"the root team", 1, false},
		{"no such team", 999_999, false},
	} {
		got, err := kinds.Monitorable(ctx, c.id)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		if got != c.want {
			t.Fatalf("%s monitorable = %v, want %v", c.name, got, c.want)
		}
	}
}
