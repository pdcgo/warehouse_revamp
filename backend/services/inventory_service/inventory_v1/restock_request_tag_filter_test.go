package inventory_v1_test

import (
	"slices"
	"testing"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE LIST'S TAG FILTER (the-restock-tags-prototype-is-accepted: several tags, a restock shown when it carries ANY of
// them — *Barang kurang* + *Barang rusak* together is the problem list). Both sides filter the same set; a restock
// carrying two of the picks is one row and counts once; another team's restock carrying the tag never shows; the filter
// narrows on top of the status tab. The cards and the file read the same predicate (TestRestockSellingStat_
// EveryFilterNarrowsAsTheList, TestRestockRequestExport_TheFileIsTheListEveryPage).
func TestRestockRequestList_FilterByTagsAnyOf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	seed := func(team, warehouse uint64, status string) uint64 {
		t.Helper()

		r := inventory_service_models.Restock{TeamID: team, WarehouseID: warehouse, Status: status}

		err := db.Create(&r).Error
		if err != nil {
			t.Fatal(err)
		}

		return r.ID
	}

	kurang := appTagID(t, db, taskMissing)
	rusak := appTagID(t, db, taskBroken)
	prioritas := seedTag(t, db, "Prioritas", "custom")

	short := seed(2, 5, "accepted")   // Barang kurang
	broken := seed(2, 5, "accepted")  // Barang rusak
	both := seed(2, 6, "accepted")    // both
	plain := seed(2, 5, "ongoing")    // Prioritas only
	none := seed(2, 5, "ongoing")     // nothing
	theirs := seed(3, 6, "accepted")  // another selling team's, Barang kurang
	inbound := seed(3, 5, "accepted") // coming to warehouse 5 from team 3, Barang rusak

	tagOn(t, db, short, kurang)
	tagOn(t, db, broken, rusak)
	tagOn(t, db, both, kurang)
	tagOn(t, db, both, rusak)
	tagOn(t, db, plain, prioritas)
	tagOn(t, db, theirs, kurang)
	tagOn(t, db, inbound, rusak)

	_ = none

	ids := func(team uint64, filter *inventoryv1.RestockRequestListFilter) []uint64 {
		t.Helper()

		var out []uint64
		for _, r := range listRows(t, svc, team, filter) {
			out = append(out, r.GetId())
		}

		slices.Sort(out)

		return out
	}

	sorted := func(v ...uint64) []uint64 {
		slices.Sort(v)
		return v
	}

	problems := []uint64{kurang, rusak}

	for _, c := range []struct {
		name   string
		team   uint64
		filter *inventoryv1.RestockRequestListFilter
		want   []uint64
	}{
		{"seller, kurang", 2, &inventoryv1.RestockRequestListFilter{TagIds: []uint64{kurang}}, sorted(short, both)},
		{"seller, rusak", 2, &inventoryv1.RestockRequestListFilter{TagIds: []uint64{rusak}}, sorted(broken, both)},
		{"seller, the problem list", 2, &inventoryv1.RestockRequestListFilter{TagIds: problems}, sorted(short, broken, both)},
		{"seller, any of three", 2, &inventoryv1.RestockRequestListFilter{TagIds: []uint64{kurang, rusak, prioritas}}, sorted(short, broken, both, plain)},
		{"seller, problems on the ongoing tab", 2, &inventoryv1.RestockRequestListFilter{
			TagIds: problems, Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING,
		}, nil},
		{"seller, problems to warehouse 6", 2, &inventoryv1.RestockRequestListFilter{TagIds: problems, WarehouseId: 6}, sorted(both)},
		{"warehouse 5, the problem list", 5, &inventoryv1.RestockRequestListFilter{TagIds: problems}, sorted(short, broken, inbound)},
		{"warehouse 6, kurang", 6, &inventoryv1.RestockRequestListFilter{TagIds: []uint64{kurang}}, sorted(both, theirs)},
		{"team 3, the problem list", 3, &inventoryv1.RestockRequestListFilter{TagIds: problems}, sorted(theirs, inbound)},
	} {
		got := ids(c.team, c.filter)
		if !slices.Equal(got, c.want) {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}

		if total := tabTotal(t, svc, c.team, c.filter); total != int64(len(c.want)) {
			t.Errorf("%s: the pager says %d, want %d — a restock with two picks counted twice?", c.name, total, len(c.want))
		}
	}

	// The row carries its tags in the chips' order.
	for _, r := range listRows(t, svc, 2, &inventoryv1.RestockRequestListFilter{TagIds: []uint64{rusak}}) {
		if r.GetId() == both && !slices.Equal(tagNames(r.GetTags()), []string{"Barang kurang", "Barang rusak"}) {
			t.Fatalf("restock %d's row reads %v", both, tagNames(r.GetTags()))
		}
	}
}
