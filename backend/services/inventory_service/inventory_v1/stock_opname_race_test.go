//go:build raceaudit

// Concurrency audit for StockOpname (the audit-sql skill).
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS, and a committing test
// sharing a database with transaction-per-test ones would leave rows the others can see.
//
//	cd backend && go test -tags raceaudit -run TestRace_StockOpname -v ./services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The tables this audit writes, CHILDREN FIRST so the harness's DELETE order does not fight foreign
// keys.
var opnameTables = []string{
	"stock_movements",
	"stock_shelf_batches",
	"stock_batches",
	"stock_levels",
	"racks",
}

// seedShelf puts one rack and two products on it, committed, so racing callers all see the same start.
func seedShelf(t *testing.T, db *gorm.DB, warehouse uint64, products map[uint64]int64) uint64 {
	t.Helper()

	var rackID uint64

	err := db.Raw(`
		INSERT INTO racks (warehouse_id, code, created_at, updated_at)
		VALUES (?, 'A-01-3', NOW(), NOW()) RETURNING id`, warehouse).Scan(&rackID).Error
	if err != nil {
		t.Fatalf("seed rack: %v", err)
	}

	for product, qty := range products {
		err = db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, ?, NOW())`, warehouse, product, rackID, qty).Error
		if err != nil {
			t.Fatalf("seed level (%d): %v", product, err)
		}
	}

	return rackID
}

func opnameOnHand(t *testing.T, db *gorm.DB, warehouse, product, rack uint64) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`
		SELECT COALESCE(on_hand, 0) FROM stock_levels
		WHERE warehouse_id = ? AND product_id = ? AND rack_id = ?`,
		warehouse, product, rack).Scan(&n).Error
	if err != nil {
		t.Fatalf("read on_hand: %v", err)
	}

	return n
}

// ⚠ THE DEADLOCK GUARD — the reason StockOpname sorts its lines by product id.
//
// Every line takes a row lock on stock_levels. Two people counting the same shelf at the same second is
// the NORMAL case here (the crew works in pairs), and if one request locked product 7 then product 3
// while the other locked 3 then 7, Postgres would break the cycle by killing one transaction — the
// person would see a stock-take fail with an error nobody can explain.
//
// So the two callers below send their lines in OPPOSITE order on purpose. The handler sorts both, so
// they converge on one order and the second waits instead of deadlocking.
func TestRace_StockOpname_OppositeLineOrdersDoNotDeadlock(t *testing.T) {
	h := san_race.New(t, opnameTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil)

	const warehouse uint64 = 5
	const p1, p2 uint64 = 100, 101

	rack := seedShelf(t, h.DB(), warehouse, map[uint64]int64{p1: 50, p2: 40})

	ctx := context.Background()

	res := h.Race(t, 8, func(i int) error {
		// Even callers count p1 first, odd callers count p2 first — the caller-order disagreement that
		// would deadlock if the handler locked in the order it was given.
		lines := []*inventoryv1.StockOpnameLine{
			{ProductId: p1, CountedQty: 45},
			{ProductId: p2, CountedQty: 38},
		}
		if i%2 == 1 {
			lines[0], lines[1] = lines[1], lines[0]
		}

		_, err := svc.StockOpname(ctx, connect.NewRequest(&inventoryv1.StockOpnameRequest{
			WarehouseId: warehouse,
			Place:       &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rack}},
			Lines:       lines,
			Note:        "race",
		}))

		return err
	})
	res.Report(t)

	// A deadlock at n=8 over two rows is a LOCK-ORDERING bug, never load.
	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d callers deadlocked — the line sort is not holding", n)
	}

	if n := res.Failed(); n != 0 {
		t.Fatalf("%d of 8 counts failed; every one of them counted the same figures and should have won", n)
	}

	// THE DATA, not the errors. Every caller counted the same figures, so whoever went last, the shelf
	// must read exactly that — a lost update would leave one of the seeded numbers behind.
	if n := opnameOnHand(t, h.DB(), warehouse, p1, rack); n != 45 {
		t.Fatalf("p1 on_hand = %d, want 45", n)
	}
	if n := opnameOnHand(t, h.DB(), warehouse, p2, rack); n != 38 {
		t.Fatalf("p2 on_hand = %d, want 38", n)
	}
}

// TWO PEOPLE COUNT THE SAME SHELF AND DISAGREE. The later count must win outright — that is what a
// count IS, the most recent observation of a physical fact — and the shelf must never end up holding
// some blend of the two.
//
// The failure this rules out is a lost update: both callers read 50, one writes 45 and the other 47,
// and the movement ledger then records two deltas that do not add up to where the shelf ended.
func TestRace_StockOpname_TheLastCountWinsCleanly(t *testing.T) {
	h := san_race.New(t, opnameTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil)

	const warehouse uint64 = 5
	const product uint64 = 100

	rack := seedShelf(t, h.DB(), warehouse, map[uint64]int64{product: 50})

	ctx := context.Background()
	counts := []int64{45, 46, 47, 48, 49, 44, 43, 42}

	res := h.Race(t, len(counts), func(i int) error {
		_, err := svc.StockOpname(ctx, connect.NewRequest(&inventoryv1.StockOpnameRequest{
			WarehouseId: warehouse,
			Place:       &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rack}},
			Lines:       []*inventoryv1.StockOpnameLine{{ProductId: product, CountedQty: counts[i]}},
			Note:        "race",
		}))

		return err
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks counting ONE row", n)
	}

	final := opnameOnHand(t, h.DB(), warehouse, product, rack)

	// The shelf must hold one of the counted figures — never the seeded 50, and never something nobody
	// counted.
	ok := false
	for _, c := range counts {
		if final == c {
			ok = true
			break
		}
	}

	if !ok {
		t.Fatalf("the shelf holds %d, which nobody counted (seeded 50, counts %v)", final, counts)
	}

	// THE LEDGER MUST RECONCILE. Every movement's delta summed onto the seed has to land exactly on the
	// final on-hand: that is the invariant a lost update breaks, and it is invisible from the level
	// alone because the level looks plausible whichever caller won.
	var sumDelta int64

	err := h.DB().Raw(`
		SELECT COALESCE(SUM(delta), 0) FROM stock_movements
		WHERE warehouse_id = ? AND product_id = ? AND rack_id = ?`,
		warehouse, product, rack).Scan(&sumDelta).Error
	if err != nil {
		t.Fatalf("sum deltas: %v", err)
	}

	if 50+sumDelta != final {
		t.Fatalf("the ledger does not reconcile: seed 50 + Σdelta %d = %d, but the shelf holds %d",
			sumDelta, 50+sumDelta, final)
	}
}

// THE PROOF OF SAFETY — a green race proves nothing, only that the window was not hit.
//
// This writes the interleaving down: B must WAIT on the row A locked, and — the half people forget —
// B must re-read AFTER the lock rather than acting on what it saw before blocking. A FOR UPDATE that
// blocks correctly and then uses a stale figure is still broken.
func TestInterleave_StockOpname_TheShelfLockHolds(t *testing.T) {
	h := san_race.New(t, opnameTables...)

	const warehouse uint64 = 5
	const product uint64 = 100

	rack := seedShelf(t, h.DB(), warehouse, map[uint64]int64{product: 50})

	lockLevel := func(tx *gorm.DB) error {
		var n int64
		return tx.Raw(`
			SELECT on_hand FROM stock_levels
			WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM ?
			FOR UPDATE`, warehouse, product, rack).Scan(&n).Error
	}

	setTo := func(v int64) func(*gorm.DB) error {
		return func(tx *gorm.DB) error {
			return tx.Exec(`
				UPDATE stock_levels SET on_hand = ?, updated_at = NOW()
				WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM ?`,
				v, warehouse, product, rack).Error
		}
	}

	var bSaw int64

	sched := h.Interleave(t,
		san_race.Do("A", "A locks the shelf line FOR UPDATE", lockLevel),
		san_race.Block("B", "B locks the same line — must WAIT", lockLevel),
		san_race.Do("A", "A writes the counted 45", setTo(45)),
		san_race.Commit("A"),
		san_race.Do("B", "B re-reads after the lock", func(tx *gorm.DB) error {
			return tx.Raw(`
				SELECT on_hand FROM stock_levels
				WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM ?`,
				warehouse, product, rack).Scan(&bSaw).Error
		}),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get("B locks the same line — must WAIT")
	if !step.Blocked {
		t.Fatal("B was NOT blocked — the FOR UPDATE on stock_levels is not holding, so two counts can interleave")
	}
	if !step.Released {
		t.Fatal("B blocked and was never released by A's commit")
	}

	// The half that is easy to miss: blocking politely and then acting on the pre-block value is still
	// a lost update. B must see A's 45, not the 50 it would have read a moment earlier.
	if bSaw != 45 {
		t.Fatalf("after the lock, B read %d — it must see A's committed count of 45, not the stale 50", bSaw)
	}
}
