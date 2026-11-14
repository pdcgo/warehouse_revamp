package category_v1_test

import (
	"context"
	"reflect"
	"slices"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	category_v1 "github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_v1"
)

// A PICKED BRANCH KEEPS ITS WHOLE SUBTREE (a-picked-branch-keeps-its-whole-subtree): Makanan is Makanan, Snack, Keripik
// and Minuman; Snack is Snack and Keripik; Keripik, an end category, is itself alone. A sibling branch is never in it.
func TestSubtreeIDs_ABranchIsEverythingBelowIt(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	makanan := insertCategory(t, db, "Makanan ST", nil)
	snack := insertCategory(t, db, "Snack", &makanan)
	keripik := insertCategory(t, db, "Keripik", &snack)
	minuman := insertCategory(t, db, "Minuman", &makanan)
	pakaian := insertCategory(t, db, "Pakaian ST", nil)
	kaos := insertCategory(t, db, "Kaos", &pakaian)

	// A soft-deleted end category under Snack: a product filed there is still under the branch.
	retired := insertCategory(t, db, "Keripik Lama", &snack)

	err := db.Exec(`UPDATE categories SET deleted = TRUE WHERE id = ?`, retired).Error
	if err != nil {
		t.Fatalf("retire: %v", err)
	}

	sorted := func(ids ...uint64) []uint64 {
		out := slices.Clone(ids)
		slices.Sort(out)

		return out
	}

	cases := []struct {
		name string
		root uint64
		want []uint64
	}{
		{"a top branch — three levels", makanan, sorted(makanan, snack, keripik, minuman, retired)},
		{"a middle branch", snack, sorted(snack, keripik, retired)},
		{"an end category — itself alone", keripik, []uint64{keripik}},
		{"the other branch", pakaian, sorted(pakaian, kaos)},
	}

	for _, c := range cases {
		got, err := category_v1.SubtreeIDs(ctx, db, c.root)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		if !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%s: %v, want %v", c.name, got, c.want)
		}
	}

	got, err := category_v1.SubtreeIDs(ctx, db, 987_654_321)
	if err != nil || len(got) != 0 {
		t.Fatalf("an unknown id: %v (%v), want nothing", got, err)
	}
}
