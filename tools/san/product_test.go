package main

import (
	"context"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

func seedCodedTeam(t *testing.T, db *gorm.DB, code string, deleted bool) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: "selling", Name: "Toko " + code, TeamCode: code, Deleted: deleted}

	err := db.Create(&team).Error
	if err != nil {
		t.Fatalf("seed team %s: %v", code, err)
	}

	return team.ID
}

func seedCodedProduct(t *testing.T, db *gorm.DB, teamID uint64, code string) uint64 {
	t.Helper()

	p := product_service_models.Product{TeamID: teamID, ProductCode: code, Name: "Product " + code}

	err := db.Create(&p).Error
	if err != nil {
		t.Fatalf("seed product %s: %v", code, err)
	}

	return p.ID
}

func codeOfProduct(t *testing.T, db *gorm.DB, id uint64) string {
	t.Helper()

	var p product_service_models.Product

	err := db.Select("product_code").Take(&p, id).Error
	if err != nil {
		t.Fatal(err)
	}

	return p.ProductCode
}

// `product recompose-codes` reads each owning team's code through team_service's TeamByIds — never its table — and puts
// it in front, once (the-field-is-product-code-composed-on-write): a second run changes nothing, and a product of a
// deleted team (TeamByIds omits it) is left as it was and named.
func TestRecomposeProductCodes_ThroughTeamService(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, teams: NewTeamCodes(db), target: "test"}

	abc := seedCodedTeam(t, db, "RCA", false)
	gone := seedCodedTeam(t, db, "RCX", true)

	shoe := seedCodedProduct(t, db, abc, "SHOE-42")
	orphan := seedCodedProduct(t, db, gone, "HAT-1")

	report, err := san.RecomposeProductCodes(context.Background())
	if err != nil {
		t.Fatalf("recompose: %v", err)
	}

	if report.Recomposed < 1 || len(report.NoTeamCode) < 1 {
		t.Fatalf("report = %+v, want the shoe recomposed and the deleted team's hat named", report)
	}

	if got := codeOfProduct(t, db, shoe); got != "RCA-SHOE-42" {
		t.Fatalf("shoe = %q, want RCA-SHOE-42", got)
	}

	if got := codeOfProduct(t, db, orphan); got != "HAT-1" {
		t.Fatalf("a deleted team's product = %q, want it left as HAT-1", got)
	}

	again, err := san.RecomposeProductCodes(context.Background())
	if err != nil {
		t.Fatalf("second recompose: %v", err)
	}

	if again.Recomposed != 0 {
		t.Fatalf("a second run recomposed %d, want 0", again.Recomposed)
	}

	if got := codeOfProduct(t, db, shoe); got != "RCA-SHOE-42" {
		t.Fatalf("a second run changed the shoe to %q", got)
	}
}
