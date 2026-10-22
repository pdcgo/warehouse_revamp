package team_v1_test

import (
	"slices"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// ONLY THE WAREHOUSES of the ids asked about: a selling team and an id that is no team are left out. A soft-deleted
// warehouse is still a warehouse — the carry-over translates the rate that exists, it does not decide which teams live.
func TestWarehouseTeamIDs_KeepsOnlyTheWarehouses(t *testing.T) {
	db := san_testdb.DB(t)

	gudang := newTeam(t, db, "warehouse", "WTI-WH")
	toko := newTeam(t, db, "selling", "WTI-SELL")
	closed := newTeam(t, db, "warehouse", "WTI-WH-GONE")

	err := db.
		Model(&team_service_models.Team{}).
		Where("id = ?", closed).
		Update("deleted", true).
		Error
	if err != nil {
		t.Fatalf("delete team: %v", err)
	}

	const noTeam uint64 = 9_999_999

	got, err := team_v1.WarehouseTeamIDs(db, []uint64{toko, closed, noTeam, gudang})
	if err != nil {
		t.Fatalf("WarehouseTeamIDs: %v", err)
	}

	want := []uint64{gudang, closed}
	slices.Sort(want)

	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want the two warehouses %v, ascending", got, want)
	}

	none, err := team_v1.WarehouseTeamIDs(db, nil)
	if err != nil || len(none) != 0 {
		t.Fatalf("no ids: %v (%v), want nothing and no query", none, err)
	}
}
