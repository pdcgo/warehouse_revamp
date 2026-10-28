package main

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
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

// seedTerms writes a creditor's terms toward one debtor as liability_service stores them. `debtor = 0` is the DEFAULT row.
func seedTerms(t *testing.T, db *gorm.DB, creditor, debtor uint64, handlingFee int64) {
	t.Helper()

	row := liability_service_models.LiabilityTerms{
		TeamID:         creditor,
		CounterpartyID: debtor,
		HandlingFee:    handlingFee,
	}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("seed terms %d→%d: %v", creditor, debtor, err)
	}
}

// rateOf is the warehouse's saved rate, read through warehouse_service, or nil when it has none.
func rateOf(t *testing.T, san *San, warehouseID uint64) *warehousev1.WarehouseFee {
	t.Helper()

	res, err := san.warehouses.WarehouseFeeDetail(context.Background(),
		connect.NewRequest(&warehousev1.WarehouseFeeDetailRequest{TeamId: warehouseID}))
	if err != nil {
		t.Fatalf("WarehouseFeeDetail(%d): %v", warehouseID, err)
	}

	return res.Msg.GetFee()
}

// EACH WAREHOUSE'S DEFAULT FLAT FEE BECOMES ITS RATE, ONCE (the-flat-rate-is-dropped-last, step 2): Gudang's 12.000 as
// 0% with floor = cap, Gratis's 0 as 0% with no cap. A warehouse that set its own rate keeps it. A selling team's
// default row (its credit limit) is no warehouse fee, a seller's own flat row has no equivalent, and a warehouse with no
// default row gets nothing — the rest set theirs. Run again, nothing is carried.
func TestCarryOverWarehouseFees_CarriesTheWarehousesDefaultsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, warehouses: NewWarehouseFees(db), target: "test"}
	ctx := context.Background()

	gudang := seedTeam(t, db, "warehouse", "CO-GUDANG")
	gratis := seedTeam(t, db, "warehouse", "CO-GRATIS")
	preset := seedTeam(t, db, "warehouse", "CO-PRESET")
	lonely := seedTeam(t, db, "warehouse", "CO-LONELY")
	toko := seedTeam(t, db, "selling", "CO-TOKO")

	seedTerms(t, db, gudang, 0, 12_000)
	seedTerms(t, db, gudang, toko, 9_000) // the seller's own flat row
	seedTerms(t, db, gratis, 0, 0)
	seedTerms(t, db, preset, 0, 7_000)
	seedTerms(t, db, toko, 0, 0) // a selling team's default row, no handling fee

	_, err := san.warehouses.WarehouseFeeSet(ctx, connect.NewRequest(&warehousev1.WarehouseFeeSetRequest{
		TeamId: preset, FeePercent: 2.5, MinFee: 2_000, MaxFee: proto.Float64(20_000),
	}))
	if err != nil {
		t.Fatalf("preset's own rate: %v", err)
	}

	report, err := san.CarryOverWarehouseFees(ctx)
	if err != nil {
		t.Fatalf("carry-over: %v", err)
	}

	if report.Carried != 2 || report.Skipped != 1 || report.NotWarehouses != 1 {
		t.Fatalf("report = %+v, want 2 carried (Gudang, Gratis), 1 skipped (Preset), 1 not a warehouse (Toko)", report)
	}

	flat := rateOf(t, san, gudang)
	if flat.GetFeePercent() != 0 || flat.GetMinFee() != 12_000 || flat.MaxFee == nil || flat.GetMaxFee() != 12_000 {
		t.Fatalf("Gudang = %+v, want 0%%, floor = cap = 12 000 — never the seller's 9 000", flat)
	}

	free := rateOf(t, san, gratis)
	if free == nil || free.GetFeePercent() != 0 || free.GetMinFee() != 0 || free.MaxFee != nil {
		t.Fatalf("Gratis = %+v, want 0%%, no floor, no cap", free)
	}

	own := rateOf(t, san, preset)
	if own.GetFeePercent() != 2.5 || own.GetMinFee() != 2_000 || own.GetMaxFee() != 20_000 {
		t.Fatalf("Preset's own rate was replaced: %+v", own)
	}

	for name, id := range map[string]uint64{"Lonely": lonely, "Toko": toko} {
		if rate := rateOf(t, san, id); rate != nil {
			t.Fatalf("%s was given a rate: %+v", name, rate)
		}
	}

	again, err := san.CarryOverWarehouseFees(ctx)
	if err != nil {
		t.Fatalf("second carry-over: %v", err)
	}

	if again.Carried != 0 || again.Skipped != 3 {
		t.Fatalf("second run = %+v, want 0 carried, 3 skipped", again)
	}
}

// THE DEV FIXTURE NEVER PRE-EMPTS THE CARRY-OVER. A warehouse with a real default flat fee gets THAT, not the worked
// example; one with neither gets 2.5% / 2.000 / 20.000; and a rate already set — the fixture's own on a second run
// included — is left alone.
func TestSeedDevWarehouseFee_ARealFlatFeeWins(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, warehouses: NewWarehouseFees(db), target: "test"}
	ctx := context.Background()

	withFlat := seedTeam(t, db, "warehouse", "DF-FLAT")
	bare := seedTeam(t, db, "warehouse", "DF-BARE")

	seedTerms(t, db, withFlat, 0, 12_000)

	line, err := seedDevWarehouseFee(ctx, db, withFlat)
	if err != nil {
		t.Fatalf("seed (flat): %v", err)
	}

	carried := rateOf(t, san, withFlat)
	if carried.GetFeePercent() != 0 || carried.GetMinFee() != 12_000 || carried.GetMaxFee() != 12_000 {
		t.Fatalf("a warehouse with a flat fee got %+v (%q), want its 12 000 carried over", carried, line)
	}

	_, err = seedDevWarehouseFee(ctx, db, bare)
	if err != nil {
		t.Fatalf("seed (bare): %v", err)
	}

	example := rateOf(t, san, bare)
	if example.GetFeePercent() != 2.5 || example.GetMinFee() != 2_000 || example.GetMaxFee() != 20_000 {
		t.Fatalf("a warehouse with nothing got %+v, want 2.5%% / 2 000 / 20 000", example)
	}

	for name, id := range map[string]uint64{"flat": withFlat, "bare": bare} {
		line, err = seedDevWarehouseFee(ctx, db, id)
		if err != nil {
			t.Fatalf("second seed (%s): %v", name, err)
		}

		if !strings.Contains(line, "already has a fee") {
			t.Fatalf("second seed (%s) said %q, want that it left the fee alone", name, line)
		}
	}

	if again := rateOf(t, san, withFlat); again.GetMinFee() != 12_000 {
		t.Fatalf("the second seed replaced the carried fee: %+v", again)
	}
}
