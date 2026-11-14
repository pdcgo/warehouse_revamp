package inventory_v1_test

import (
	"context"
	"reflect"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE LOCK IN FORCE (ClosedByMinimum): a minimum closes a product to other teams while its owner's ready stock across
// EVERY warehouse is UNDER it — at exactly the minimum it is open (a-minimum-closes-only-under-it), the order take's own
// line (notAllowedLines: allowed at total >= reserve).

const (
	cmMelati  uint64 = 9_300_001
	cmSinar   uint64 = 9_300_002
	cmGudang1 uint64 = 9_300_011
	cmGudang2 uint64 = 9_300_012
)

// cmTx is the minting transaction every seeded batch points at (batches.transaction_id is a foreign key).
func cmTx(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		VALUES (?, ?, 'restock', 1, 'closed-by-minimum') RETURNING id`, cmGudang1, cmMelati).Scan(&id).Error
	if err != nil {
		t.Fatalf("seed transaction: %v", err)
	}

	return id
}

// cmBatch seeds one batch of `count` ready units owned by `team`, arrived at `arrived`.
func cmBatch(t *testing.T, db *gorm.DB, tx, warehouse, team, product uint64, count int64, arrived time.Time) {
	t.Helper()

	err := db.Exec(`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count,
		stock_valuation, init_stock_count, init_stock_valuation, created_at)
		VALUES (?, ?, ?, ?, 1000, ?, ?, ?, ?, ?)`,
		warehouse, team, product, tx, count, float64(count)*1000, count+1, float64(count+1)*1000, arrived).Error
	if err != nil {
		t.Fatalf("seed batch of product %d: %v", product, err)
	}
}

func TestClosedByMinimum_OnlyUnderTheMinimumAcrossEveryWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	tx := cmTx(t, db)
	now := time.Now()

	const (
		under    uint64 = 9_300_101 // 10 + 9 = 19 across two warehouses, minimum 20
		at       uint64 = 9_300_102 // 10 + 10 = 20 — exactly the minimum: open
		over     uint64 = 9_300_103 // 21
		none     uint64 = 9_300_104 // never stocked
		emptied  uint64 = 9_300_105 // one batch, emptied by orders
		theirs   uint64 = 9_300_106 // Melati's product id, but the units are Sinar's: not Melati's stock
		sinarLow uint64 = 9_300_201 // Sinar's own, 1 under 2
		sinarOK  uint64 = 9_300_202 // Sinar's own, 3 over 2
	)

	cmBatch(t, db, tx, cmGudang1, cmMelati, under, 10, now)
	cmBatch(t, db, tx, cmGudang2, cmMelati, under, 9, now)
	cmBatch(t, db, tx, cmGudang1, cmMelati, at, 10, now)
	cmBatch(t, db, tx, cmGudang2, cmMelati, at, 10, now)
	cmBatch(t, db, tx, cmGudang1, cmMelati, over, 21, now)
	cmBatch(t, db, tx, cmGudang1, cmMelati, emptied, 0, now)
	cmBatch(t, db, tx, cmGudang1, cmSinar, theirs, 100, now)
	cmBatch(t, db, tx, cmGudang1, cmSinar, sinarLow, 1, now)
	cmBatch(t, db, tx, cmGudang2, cmSinar, sinarOK, 3, now)

	got, err := inventory_v1.ClosedByMinimum(context.Background(), db, []inventory_v1.MinimumCandidate{
		{TeamID: cmMelati, ProductID: under, Minimum: 20},
		{TeamID: cmMelati, ProductID: at, Minimum: 20},
		{TeamID: cmMelati, ProductID: over, Minimum: 20},
		{TeamID: cmMelati, ProductID: none, Minimum: 1},
		{TeamID: cmMelati, ProductID: emptied, Minimum: 1},
		{TeamID: cmMelati, ProductID: theirs, Minimum: 1},
		// Discover will hand candidates of many teams at once.
		{TeamID: cmSinar, ProductID: sinarLow, Minimum: 2},
		{TeamID: cmSinar, ProductID: sinarOK, Minimum: 2},
	})
	if err != nil {
		t.Fatalf("ClosedByMinimum: %v", err)
	}

	want := []uint64{under, none, emptied, theirs, sinarLow}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("closed = %v, want %v — under (19 < 20), never stocked, emptied, units owned by another team, Sinar's 1 < 2; "+
			"never the one AT its minimum, nor one over it", got, want)
	}
}

// One unit taken off a product at its minimum closes it; one received opens it again — the boundary moves with the shelf.
func TestClosedByMinimum_TheBoundaryFollowsTheShelf(t *testing.T) {
	db := san_testdb.DB(t)
	tx := cmTx(t, db)

	const product uint64 = 9_300_301

	cmBatch(t, db, tx, cmGudang1, cmMelati, product, 5, time.Now())

	ask := func(minimum int64) bool {
		t.Helper()

		got, err := inventory_v1.ClosedByMinimum(context.Background(), db, []inventory_v1.MinimumCandidate{
			{TeamID: cmMelati, ProductID: product, Minimum: minimum},
		})
		if err != nil {
			t.Fatalf("ClosedByMinimum(%d): %v", minimum, err)
		}

		return len(got) == 1
	}

	if ask(4) || ask(5) || !ask(6) {
		t.Fatalf("5 ready: minimum 4 = %v, 5 = %v, 6 = %v — want open, open, closed", ask(4), ask(5), ask(6))
	}
}

func TestClosedByMinimum_NoCandidatesAsksNothing(t *testing.T) {
	db := san_testdb.DB(t)

	got, err := inventory_v1.ClosedByMinimum(context.Background(), db, nil)
	if err != nil || len(got) != 0 {
		t.Fatalf("no candidates = %v, %v — want none, no error", got, err)
	}
}
