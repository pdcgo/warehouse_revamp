package product_v1_test

import (
	"context"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// lookupCodes is the bulk team-code read the recompose takes: team 2 is ABC, team 3 is XYZ, every other team is unknown.
func lookupCodes(_ context.Context, teamIDs []uint64) (map[uint64]string, error) {
	known := map[uint64]string{2: "ABC", 3: "XYZ"}
	out := map[uint64]string{}

	for _, id := range teamIDs {
		if code, ok := known[id]; ok {
			out[id] = code
		}
	}

	return out, nil
}

func codeOfRow(t *testing.T, db *gorm.DB, id uint64) string {
	t.Helper()

	var code string

	err := db.Table("products").Where("id = ?", id).Pluck("product_code", &code).Error
	if err != nil {
		t.Fatal(err)
	}

	return code
}

// Each of today's rows takes its team's code in front, once (the-field-is-product-code-composed-on-write): an archived
// row too, since it keeps its code; a row of a team with no code is left as it was and named.
func TestRecomposeProductCodes_PutsEachTeamsCodeInFrontOnce(t *testing.T) {
	db := san_testdb.DB(t)

	shoe := insertProduct(t, db, 2, "SHOE-42", "Shoe")
	archived := insertProduct(t, db, 2, "HAT-1", "Hat")
	setProduct(t, db, archived, "archived", true)
	theirs := insertProduct(t, db, 3, "SHOE-43", "Their shoe")
	orphan := insertProduct(t, db, 77, "LOST-1", "A team team_service does not know")

	report, err := product_v1.RecomposeProductCodes(context.Background(), db, lookupCodes)
	if err != nil {
		t.Fatalf("recompose: %v", err)
	}

	if report.Recomposed != 3 || report.AlreadyComposed != 0 || len(report.NoTeamCode) != 1 || report.NoTeamCode[0] != orphan {
		t.Fatalf("report = %+v, want 3 recomposed, 0 already, [%d] without a team code", report, orphan)
	}

	want := map[uint64]string{shoe: "ABC-SHOE-42", archived: "ABC-HAT-1", theirs: "XYZ-SHOE-43", orphan: "LOST-1"}
	for id, code := range want {
		if got := codeOfRow(t, db, id); got != code {
			t.Fatalf("product %d code = %q, want %q", id, got, code)
		}
	}

	// Run again: everything already reads as composed, and nothing changes.
	again, err := product_v1.RecomposeProductCodes(context.Background(), db, lookupCodes)
	if err != nil {
		t.Fatalf("second recompose: %v", err)
	}

	if again.Recomposed != 0 || again.AlreadyComposed != 3 {
		t.Fatalf("second run = %+v, want 0 recomposed, 3 already composed", again)
	}

	if got := codeOfRow(t, db, shoe); got != "ABC-SHOE-42" {
		t.Fatalf("a second run changed the code to %q", got)
	}
}

// Two products that would end up carrying ONE code fail the whole run, both named, and nothing is written.
func TestRecomposeProductCodes_ACollisionWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)

	composed := insertProduct(t, db, 2, "ABC-SHOE-42", "Typed with the prefix already")
	bare := insertProduct(t, db, 2, "SHOE-42", "Typed bare")
	other := insertProduct(t, db, 3, "CAP-1", "Their cap")

	_, err := product_v1.RecomposeProductCodes(context.Background(), db, lookupCodes)
	if err == nil {
		t.Fatalf("recompose onto a code already carried succeeded")
	}

	if !strings.Contains(err.Error(), "ABC-SHOE-42") {
		t.Fatalf("the refusal does not name the code: %v", err)
	}

	for id, code := range map[uint64]string{composed: "ABC-SHOE-42", bare: "SHOE-42", other: "CAP-1"} {
		if got := codeOfRow(t, db, id); got != code {
			t.Fatalf("product %d code = %q after a refused run, want %q", id, got, code)
		}
	}
}
