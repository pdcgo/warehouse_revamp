package main

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// A selling team's expenses sit under Seller, a warehouse team's under Warehouse (the-warehouse-is-its-own-group) — read
// off team_service's `teams.type`. The root team, an admin team and a team that does not exist sit on neither side.
func TestExpenseTeamSides_SellerWarehouseOrNeither(t *testing.T) {
	db := san_testdb.DB(t)
	sides := NewExpenseTeamSides(db)
	ctx := context.Background()

	ids := map[string]uint64{}

	for i, kind := range []string{"warehouse", "selling", "admin"} {
		team := team_service_models.Team{Type: kind, Name: "sides " + kind, TeamCode: []string{"SW", "SS", "SA"}[i]}

		err := db.Create(&team).Error
		if err != nil {
			t.Fatalf("team %s: %v", kind, err)
		}

		ids[kind] = team.ID
	}

	for _, c := range []struct {
		name string
		id   uint64
		want expense_v1.TeamSide
	}{
		{"a warehouse", ids["warehouse"], expense_v1.SideWarehouse},
		{"a selling team", ids["selling"], expense_v1.SideSeller},
		{"an admin team", ids["admin"], expense_v1.SideNeither},
		{"the root team", 1, expense_v1.SideNeither},
		{"no such team", 999_999, expense_v1.SideNeither},
	} {
		// Twice: the second answer is the remembered one, and must not differ.
		for range 2 {
			got, err := sides.SideOf(ctx, c.id)
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			if got != c.want {
				t.Fatalf("%s sits on side %v, want %v", c.name, got, c.want)
			}
		}
	}
}
