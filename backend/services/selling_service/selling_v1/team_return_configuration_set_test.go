package selling_v1_test

import (
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The first Set creates the team's row.
func TestTeamReturnConfigurationSet_Creates(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := setReturnWarehouse(t, svc, 2, 41)
	if got.GetTeamId() != 2 || got.GetWarehouseId() != 41 {
		t.Fatalf("configuration = %+v, want team 2 → warehouse 41", got)
	}

	if rows := countReturnRows(t, db, 2); rows != 1 {
		t.Fatalf("rows for team 2 = %d, want 1", rows)
	}
}

// A second Set REPLACES the warehouse on the same row — never a second row for the team, which would leave the
// create check and the return reading two different answers.
func TestTeamReturnConfigurationSet_ReplacesOnTheSameRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	setReturnWarehouse(t, svc, 2, 41)
	got := setReturnWarehouse(t, svc, 2, 58)

	if got.GetWarehouseId() != 58 {
		t.Fatalf("warehouse = %d, want 58 (the later Set)", got.GetWarehouseId())
	}

	if rows := countReturnRows(t, db, 2); rows != 1 {
		t.Fatalf("rows for team 2 = %d, want 1 — a replace inserted a second row", rows)
	}
}

func countReturnRows(t *testing.T, db *gorm.DB, teamID uint64) int64 {
	t.Helper()

	var n int64

	err := db.Raw("SELECT count(*) FROM team_return_configurations WHERE team_id = ?", teamID).Scan(&n).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	return n
}
