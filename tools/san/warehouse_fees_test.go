package main

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// seedTeam writes a team as team_service stores it.
func seedTeam(t *testing.T, db *gorm.DB, teamType, code string) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: teamType, Name: code, TeamCode: code}

	err := db.Create(&team).Error
	if err != nil {
		t.Fatalf("seed team %s: %v", code, err)
	}

	return team.ID
}

// rateOf is the warehouse's saved rate, read through warehouse_service, or nil when it has none.
func rateOf(t *testing.T, db *gorm.DB, warehouseID uint64) *warehousev1.WarehouseFee {
	t.Helper()

	res, err := NewWarehouseFees(db).WarehouseFeeDetail(context.Background(),
		connect.NewRequest(&warehousev1.WarehouseFeeDetailRequest{TeamId: warehouseID}))
	if err != nil {
		t.Fatalf("WarehouseFeeDetail(%d): %v", warehouseID, err)
	}

	return res.Msg.GetFee()
}

// THE DEV FIXTURE'S RATE: a warehouse with none gets the worked example, 2.5% / 2.000 / 20.000; a rate already set —
// the fixture's own on a second run included — is left alone.
func TestSeedDevWarehouseFee_WritesTheExampleOnce(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	bare := seedTeam(t, db, "warehouse", "DF-BARE")

	_, err := seedDevWarehouseFee(ctx, db, bare)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	example := rateOf(t, db, bare)
	if example.GetFeePercent() != 2.5 || example.GetMinFee() != 2_000 || example.GetMaxFee() != 20_000 {
		t.Fatalf("a warehouse with nothing got %+v, want 2.5%% / 2 000 / 20 000", example)
	}

	line, err := seedDevWarehouseFee(ctx, db, bare)
	if err != nil {
		t.Fatalf("second seed: %v", err)
	}

	if !strings.Contains(line, "already has a fee") {
		t.Fatalf("second seed said %q, want that it left the fee alone", line)
	}
}
