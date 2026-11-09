package product_v1_test

import (
	"context"
	"slices"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// A warehouse's picker searches ONLY among the products inventory hands over (a-warehouse-picks-only-what-it-has-held):
// by name or by product code, live ones only, by name — and never one outside the set, however well it matches.
func TestSearchAmong_SearchesOnlyTheGivenProducts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	kaosMelati := insertProduct(t, db, 2, "T2-KAOS-01", "Kaos Temuan")
	kaosSinar := insertProduct(t, db, 3, "T3-KAOS-01", "Kaos Temuan")
	kemeja := insertProduct(t, db, 2, "T2-KMJ-07", "Kemeja Flanel")
	locked := insertProduct(t, db, 3, "T3-SARUNG-1", "Sarung Tenun")
	archived := insertProduct(t, db, 2, "T2-KAOS-OLD", "Kaos Temuan Lama")
	outside := insertProduct(t, db, 4, "T4-KAOS-09", "Kaos Temuan")

	err := db.
		Model(&product_service_models.Product{}).
		Where("id = ?", locked).
		Update("cross_locked", true).
		Error
	if err != nil {
		t.Fatalf("lock: %v", err)
	}

	err = db.
		Model(&product_service_models.Product{}).
		Where("id = ?", archived).
		Update("archived", true).
		Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	held := []uint64{kaosMelati, kaosSinar, kemeja, locked, archived}

	archivedOf := map[uint64]bool{}

	search := func(q string, offset, limit int) ([]uint64, []uint64, int64) {
		t.Helper()

		rows, total, searchErr := svc.SearchAmong(context.Background(), product_v1.ProductSearchAmong{
			IDs: held, Q: q, Offset: offset, Limit: limit,
		})
		if searchErr != nil {
			t.Fatalf("search %q: %v", q, searchErr)
		}

		ids := make([]uint64, 0, len(rows))
		teams := make([]uint64, 0, len(rows))

		for _, r := range rows {
			ids = append(ids, r.GetId())
			teams = append(teams, r.GetTeamId())
			archivedOf[r.GetId()] = r.GetArchived()
		}

		return ids, teams, total
	}

	// By name: both teams' Kaos Temuan, each with its owner, then the archived Kaos Temuan Lama — held here, so still
	// offered and flagged (an-archived-product-held-here-can-be-picked) — and never the one outside the set.
	ids, teams, total := search("kaos tem", 0, 10)
	if total != 3 || len(ids) != 3 || ids[2] != archived {
		t.Fatalf("kaos tem = %v (total %d), want the two held Kaos Temuan, then the archived Lama", ids, total)
	}

	for _, id := range ids {
		if id == outside {
			t.Fatalf("kaos tem found %d — outside the held set", id)
		}
	}

	if !archivedOf[archived] || archivedOf[ids[0]] || archivedOf[ids[1]] {
		t.Fatalf("archived flags = %v, want only the Lama archived", archivedOf)
	}

	if teams[0] == teams[1] {
		t.Fatalf("the two Kaos Temuan read one owner %v — two teams' same-named products must be told apart", teams)
	}

	// By product code, any part of it, case-insensitive.
	ids, _, total = search("kmj-0", 0, 10)
	if total != 1 || len(ids) != 1 || ids[0] != kemeja {
		t.Fatalf("kmj-0 = %v (total %d), want only Kemeja Flanel", ids, total)
	}

	// A LOCKED product is still found — the lock is about other teams selling it, not the warehouse holding it.
	ids, _, _ = search("sarung", 0, 10)
	if len(ids) != 1 || ids[0] != locked {
		t.Fatalf("sarung = %v, want the locked Sarung Tenun", ids)
	}

	// A LIKE wildcard is a character, not a match-all.
	_, _, total = search("%%", 0, 10)
	if total != 0 {
		t.Fatalf("%%%% matched %d products, want none", total)
	}

	// Paging: a window of one, by name then product code — the total still counts all three.
	first, _, total := search("kaos", 0, 1)
	second, _, _ := search("kaos", 1, 1)

	if total != 3 || len(first) != 1 || len(second) != 1 || first[0] == second[0] {
		t.Fatalf("pages of one = %v then %v (total %d), want the Kaos Temuan one per page, three in all", first, second, total)
	}

	if first[0] != kaosMelati {
		t.Fatalf("page 1 = %v, want T2-KAOS-01 first (same name, then product code)", first)
	}

	// A window past the last match: no rows, and the total still says how many there are.
	past, _, total := search("kaos", 5, 1)
	if len(past) != 0 || total != 3 {
		t.Fatalf("past the end = %v (total %d), want nothing of 3", past, total)
	}
}

// Nothing to search among answers nothing — never the whole catalogue.
func TestSearchAmong_AnEmptySetFindsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "T2-KAOS-01", "Kaos Temuan")

	rows, total, err := svc.SearchAmong(context.Background(), product_v1.ProductSearchAmong{Q: "kaos", Limit: 10})
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	if total != 0 || len(rows) != 0 {
		t.Fatalf("an empty set found %d (total %d), want nothing", len(rows), total)
	}
}

// NO TERM LISTS THE WHOLE SET (the-stock-screen-lists-what-the-warehouse-has-held): the Stock screen before anything is
// typed — every product of the given ids, archived ones flagged, in the search's order, paged, the total from the same
// statement — and still never one outside the set.
func TestSearchAmong_NoTermListsTheWholeSet(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	kemeja := insertProduct(t, db, 2, "T2-KMJ-07", "Kemeja Flanel")
	kaosSinar := insertProduct(t, db, 3, "T3-KAOS-01", "Kaos Temuan")
	kaosMelati := insertProduct(t, db, 2, "T2-KAOS-01", "Kaos Temuan")
	archived := insertProduct(t, db, 2, "T2-KAOS-OLD", "Kaos Lama")
	insertProduct(t, db, 4, "T4-KAOS-09", "Kaos Abu") // outside the set

	err := db.
		Model(&product_service_models.Product{}).
		Where("id = ?", archived).
		Update("archived", true).
		Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	held := []uint64{kemeja, kaosSinar, kaosMelati, archived}

	list := func(q string, offset, limit int) ([]uint64, map[uint64]bool, int64) {
		t.Helper()

		rows, total, listErr := svc.SearchAmong(context.Background(), product_v1.ProductSearchAmong{
			IDs: held, Q: q, Offset: offset, Limit: limit,
		})
		if listErr != nil {
			t.Fatalf("list %q: %v", q, listErr)
		}

		ids := make([]uint64, 0, len(rows))
		flags := map[uint64]bool{}

		for _, r := range rows {
			ids = append(ids, r.GetId())
			flags[r.GetId()] = r.GetArchived()
		}

		return ids, flags, total
	}

	want := []uint64{archived, kaosMelati, kaosSinar, kemeja}

	// Spaces alone are no term.
	for _, q := range []string{"", "   "} {
		ids, flags, total := list(q, 0, 10)
		if !slices.Equal(ids, want) || total != 4 {
			t.Fatalf("%q = %v (total %d), want %v — the whole set by name, then code, never the one outside it", q, ids, total, want)
		}

		if !flags[archived] || flags[kaosMelati] {
			t.Fatalf("archived flags = %v, want only Kaos Lama", flags)
		}
	}

	second, _, total := list("", 2, 2)
	if !slices.Equal(second, []uint64{kaosSinar, kemeja}) || total != 4 {
		t.Fatalf("second page of two = %v (total %d), want Sinar's Kaos Temuan then Kemeja Flanel of 4", second, total)
	}

	past, _, total := list("", 10, 2)
	if len(past) != 0 || total != 4 {
		t.Fatalf("past the end = %v (total %d), want nothing of 4", past, total)
	}
}
