package main

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// THE TEAM CODE PREVIEW THROUGH THE REAL SEAM (backlog #150): team_service's TeamCodePreview → this root's
// productCodeRecomposer.PreviewTeamCodes → product_service's PreviewTeamRecompose, which asks inventory's own placements
// (productStockNarrower.StockSitsAmong) on the caller's db — and team_service names the warehouses. Its figures must be
// what the write then does: the same products counted, the same warehouses waiting.

func warehouseTeam(t *testing.T, db *gorm.DB, name, code string) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: "warehouse", Name: name, TeamCode: code}

	err := db.Create(&team).Error
	if err != nil {
		t.Fatal(err)
	}

	return team.ID
}

func previewTeamCode(t *testing.T, w codeEditWorld, team uint64, code string) *teamv1.TeamCodePreviewResponse {
	t.Helper()

	resp, err := w.teams.TeamCodePreview(asOwnerOf(team), connect.NewRequest(&teamv1.TeamCodePreviewRequest{TeamId: team, TeamCode: code}))
	if err != nil {
		t.Fatalf("TeamCodePreview %s: %v", code, err)
	}

	return resp.Msg
}

func TestTeamCodePreview_SaysWhatTheWriteThenDoes(t *testing.T) {
	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	pusat := warehouseTeam(t, db, "Gudang Pusat E150", "E150-WH1")
	cabang := warehouseTeam(t, db, "Gudang Cabang E150", "E150-WH2")
	timur := warehouseTeam(t, db, "Gudang Timur E150", "E150-WH3")
	kosong := warehouseTeam(t, db, "Gudang Kosong E150", "E150-WH4")

	team := sellingTeam(t, db, "Toko Anggrek E150", "E150-ABC")
	sellingTeam(t, db, "Toko Melati E150", "E150-SL1")

	// The lowest id is ARCHIVED (with stock on a shelf in Timur): counted, its warehouse named, never the example.
	old := insertCatalogue(t, db, team, "E150-ABC-LAMA", "Lama", false)
	shoe := insertCatalogue(t, db, team, "E150-ABC-SHOE-42", "Sepatu", false)
	bag := insertCatalogue(t, db, team, "E150-ABC-TAS-01", "Tas", false)
	// Nothing on a shelf: counted, names no warehouse — one never stocked, one whose shelf is at 0 now (in Kosong).
	insertCatalogue(t, db, team, "E150-ABC-BARU", "Baru", false)
	soldOut := insertCatalogue(t, db, team, "E150-ABC-HABIS", "Habis", false)

	stockHeld(t, w.inventory, team, timur, old, 1)
	stockHeld(t, w.inventory, team, pusat, shoe, 3)
	stockHeld(t, w.inventory, team, cabang, bag, 2)
	stockHeld(t, w.inventory, team, kosong, soldOut, 4)

	err := db.Exec("UPDATE products SET archived = TRUE WHERE id = ?", old).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec("UPDATE product_placements SET stock_count = 0 WHERE product_id = ?", soldOut).Error
	if err != nil {
		t.Fatal(err)
	}

	// Another team's code: refused, named — no figures.
	taken := previewTeamCode(t, w, team, "E150-SL1")
	if taken.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_TAKEN || taken.GetHolderTeamName() != "Toko Melati E150" ||
		taken.GetProducts() != 0 {
		t.Errorf("another team's code = %+v, want TAKEN by Toko Melati E150, no figures", taken)
	}

	// The new code: 5 products (the archived one too), the ACTIVE example, the three warehouses holding units now, sorted.
	got := previewTeamCode(t, w, team, "E150-XYZ")

	if got.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_CHANGES || got.GetProducts() != 5 {
		t.Fatalf("preview = %+v, want CHANGES with 5 products", got)
	}

	if got.GetExampleOldCode() != "E150-ABC-SHOE-42" || got.GetExampleNewCode() != "E150-XYZ-SHOE-42" {
		t.Errorf("example = %q → %q, want E150-ABC-SHOE-42 → E150-XYZ-SHOE-42", got.GetExampleOldCode(), got.GetExampleNewCode())
	}

	wantNames := []string{"Gudang Cabang E150", "Gudang Pusat E150", "Gudang Timur E150"}
	if !slices.Equal(got.GetWarehouseNames(), wantNames) {
		t.Errorf("warehouses = %v, want %v (never Kosong, whose shelf is at 0)", got.GetWarehouseNames(), wantNames)
	}

	// The preview wrote nothing: every code as it was.
	if code := productCodeOf(t, db, shoe); code != "E150-ABC-SHOE-42" {
		t.Errorf("the preview moved a code: %q", code)
	}

	// The write then does what the preview said.
	resp, err := w.teams.TeamCodeUpdate(asOwnerOf(team), connect.NewRequest(&teamv1.TeamCodeUpdateRequest{TeamId: team, TeamCode: "E150-XYZ"}))
	if err != nil {
		t.Fatalf("TeamCodeUpdate: %v", err)
	}

	if resp.Msg.GetProductsRecomposed() != got.GetProducts() {
		t.Errorf("the write recomposed %d, the preview said %d", resp.Msg.GetProductsRecomposed(), got.GetProducts())
	}

	var waiting []string

	err = db.Raw(`SELECT DISTINCT t.name FROM product_reprint_waits w JOIN teams t ON t.id = w.warehouse_id
		WHERE w.product_id IN ? ORDER BY t.name`, []uint64{old, shoe, bag, soldOut}).Scan(&waiting).Error
	if err != nil {
		t.Fatal(err)
	}

	if !slices.Equal(waiting, got.GetWarehouseNames()) {
		t.Errorf("the write's reprint waits are in %v, the preview named %v", waiting, got.GetWarehouseNames())
	}

	// Now the code is the team's own: the same code is no change.
	if same := previewTeamCode(t, w, team, "E150-XYZ"); same.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_SAME {
		t.Errorf("the team's own code = %v, want SAME", same.GetVerdict())
	}

	// Its old code stays the team's — another team asking for it is refused as a FORMER code, naming it.
	other := sellingTeam(t, db, "Toko Lain E150", "E150-OTH")
	if former := previewTeamCode(t, w, other, "E150-ABC"); former.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_FORMER ||
		former.GetHolderTeamName() != "Toko Anggrek E150" {
		t.Errorf("the old code asked by another team = %+v, want FORMER, Toko Anggrek E150", former)
	}
}
