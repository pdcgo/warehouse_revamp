package inventory_v1_test

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE STOCK'S AGE (ProductIDsAgedSince): a team's products whose oldest batch still holding READY units arrived by the
// cutoff — the same oldest batch the list's Umur stok column reads (the-dates-read-as-ages), in the lens's warehouse.

func TestProductIDsAgedSince_TheOldestReadyBatchByTheCutoff(t *testing.T) {
	db := san_testdb.DB(t)
	tx := cmTx(t, db)
	cutoff := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)

	const (
		exactly   uint64 = 9_301_001 // arrived AT the cutoff: in
		justAfter uint64 = 9_301_002 // a second after: out
		older     uint64 = 9_301_003 // ten days before, plus a fresh batch: its OLDEST ready one counts
		emptied   uint64 = 9_301_004 // its old batch emptied, only a fresh one ready: out
		none      uint64 = 9_301_005 // nothing on a shelf: no age, never in
		split     uint64 = 9_301_006 // old in Gudang 1, fresh in Gudang 2: the lens decides
		theirs    uint64 = 9_301_007 // Sinar's units under this id: never Melati's age
	)

	cmBatch(t, db, tx, cmGudang1, cmMelati, exactly, 3, cutoff)
	cmBatch(t, db, tx, cmGudang1, cmMelati, justAfter, 3, cutoff.Add(time.Second))
	cmBatch(t, db, tx, cmGudang1, cmMelati, older, 3, cutoff.AddDate(0, 0, -10))
	cmBatch(t, db, tx, cmGudang1, cmMelati, older, 3, cutoff.AddDate(0, 0, 5))
	cmBatch(t, db, tx, cmGudang1, cmMelati, emptied, 0, cutoff.AddDate(0, 0, -100))
	cmBatch(t, db, tx, cmGudang1, cmMelati, emptied, 4, cutoff.AddDate(0, 0, 1))
	cmBatch(t, db, tx, cmGudang1, cmMelati, none, 0, cutoff.AddDate(0, 0, -100))
	cmBatch(t, db, tx, cmGudang1, cmMelati, split, 2, cutoff.AddDate(0, 0, -30))
	cmBatch(t, db, tx, cmGudang2, cmMelati, split, 2, cutoff.AddDate(0, 0, 2))
	cmBatch(t, db, tx, cmGudang1, cmSinar, theirs, 9, cutoff.AddDate(0, 0, -200))

	ask := func(team, warehouse uint64) []uint64 {
		t.Helper()

		got, err := inventory_v1.ProductIDsAgedSince(context.Background(), db, team, warehouse, cutoff)
		if err != nil {
			t.Fatalf("ProductIDsAgedSince(%d, %d): %v", team, warehouse, err)
		}

		return got
	}

	if got, want := ask(cmMelati, 0), []uint64{exactly, older, split}; !reflect.DeepEqual(got, want) {
		t.Fatalf("every warehouse = %v, want %v", got, want)
	}

	if got, want := ask(cmMelati, cmGudang1), []uint64{exactly, older, split}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Gudang 1 = %v, want %v", got, want)
	}

	if got := ask(cmMelati, cmGudang2); len(got) != 0 {
		t.Fatalf("Gudang 2 = %v, want none — only fresh units there", got)
	}

	if got, want := ask(cmSinar, 0), []uint64{theirs}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Sinar = %v, want only its own units' product", got)
	}
}
