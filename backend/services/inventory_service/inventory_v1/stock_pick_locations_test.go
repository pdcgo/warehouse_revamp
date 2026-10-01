package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func pickLocations(t *testing.T, svc *inventory_v1.Service, ref string) []*inventoryv1.StockPickLocation {
	t.Helper()

	res, err := svc.StockPickLocations(ctxUser(1), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
		WarehouseId: warehouseA, Ref: ref,
	}))
	if err != nil {
		t.Fatalf("StockPickLocations(%q): %v", ref, err)
	}

	return res.Msg.GetLocations()
}

// #151 — THE question the pick screen exists to answer: a product drawn from THREE places is reported
// as three shelves with their own quantities, not as one shelf the screen picked for itself.
//
// The order matters as much as the contents: it is the walk StockPick already planned (#149) — unplaced
// first, then shelves by label — so the picker follows the route the system committed to rather than a
// shuffle that changes between page loads.
func TestStockPickLocations_ReportsEveryShelfTheGoodsCameFrom(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const sellingTeam uint64 = 2

	// Out of label order on purpose, exactly as the drain test does.
	rackB := insertRack(t, db, warehouseA, "B-02-1")
	rackA := insertRack(t, db, warehouseA, "A-01-3")

	seed := func(rack *uint64, onHand int64) {
		t.Helper()

		err := db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, ?, NOW())`,
			warehouseA, productX, rack, onHand,
		).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	seed(nil, 3)
	seed(&rackA, 4)
	seed(&rackB, 100)

	_, err := svc.StockPick(ctxUser(1), connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, Ref: "order:42",
		Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: 10}},
	}))
	if err != nil {
		t.Fatalf("StockPick: %v", err)
	}

	got := pickLocations(t, svc, "order:42")

	if len(got) != 3 {
		t.Fatalf("the goods came from 3 places, the screen was told about %d: %+v", len(got), got)
	}

	// Unplaced first — rack 0, and the quantity is POSITIVE even though the ledger stores a pick as a
	// negative delta. A picker is told "take 3", never "take -3".
	if got[0].GetRackId() != 0 || got[0].GetQuantity() != 3 {
		t.Fatalf("first stop = rack %d qty %d, want the unplaced pile (rack 0) qty 3",
			got[0].GetRackId(), got[0].GetQuantity())
	}

	if got[1].GetRackCode() != "A-01-3" || got[1].GetQuantity() != 4 {
		t.Fatalf("second stop = %q qty %d, want A-01-3 qty 4", got[1].GetRackCode(), got[1].GetQuantity())
	}

	// Only the REMAINDER from B-02-1 — it holds 100, but this order took 3.
	if got[2].GetRackCode() != "B-02-1" || got[2].GetQuantity() != 3 {
		t.Fatalf("third stop = %q qty %d, want B-02-1 qty 3", got[2].GetRackCode(), got[2].GetQuantity())
	}
}

// #151 — the locations belong to ONE ref. Another order's pick from the same shelves must not appear in
// this order's walk, or a picker collects twice what the order needs.
func TestStockPickLocations_AreScopedToTheirOwnPick(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	rack := insertRack(t, db, warehouseA, "A-01-1")

	err := db.Exec(`
		INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
		VALUES (?, ?, ?, ?, NOW())`, warehouseA, productX, &rack, int64(50)).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	for _, spec := range []struct {
		ref string
		qty int64
	}{{"order:1", 2}, {"order:2", 7}} {
		_, pickErr := svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
			TeamId: sellingTeam, WarehouseId: warehouseA, Ref: spec.ref,
			Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: spec.qty}},
		}))
		if pickErr != nil {
			t.Fatalf("StockPick(%s): %v", spec.ref, pickErr)
		}
	}

	first := pickLocations(t, svc, "order:1")
	if len(first) != 1 || first[0].GetQuantity() != 2 {
		t.Fatalf("order:1's walk = %+v, want a single stop for 2", first)
	}

	second := pickLocations(t, svc, "order:2")
	if len(second) != 1 || second[0].GetQuantity() != 7 {
		t.Fatalf("order:2's walk = %+v, want a single stop for 7", second)
	}

	// An unknown ref is an empty walk, not an error — nothing was ever picked under it.
	if none := pickLocations(t, svc, "order:999"); len(none) != 0 {
		t.Fatalf("an unpicked ref reported %d stops, want none", len(none))
	}
}

// #151/#70 — a RETURNED pick leaves no walk. The goods went back on the shelf, so sending a picker after
// them would be sending them after stock that is once again available to everybody else.
//
// This is why the query reads PICK rows only rather than netting PICK against RETURN.
func TestStockPickLocations_AReturnedPickHasNoWalk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	rack := insertRack(t, db, warehouseA, "A-01-1")

	err := db.Exec(`
		INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
		VALUES (?, ?, ?, ?, NOW())`, warehouseA, productX, &rack, int64(20)).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err = svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, Ref: "order:7",
		Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: 5}},
	}))
	if err != nil {
		t.Fatalf("StockPick: %v", err)
	}

	if got := pickLocations(t, svc, "order:7"); len(got) != 1 {
		t.Fatalf("before the return the walk had %d stops, want 1", len(got))
	}

	_, err = svc.StockReturn(ctx, connect.NewRequest(&inventoryv1.StockReturnRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, Ref: "order:7",
	}))
	if err != nil {
		t.Fatalf("StockReturn: %v", err)
	}

	// NOTE what this pins, precisely: the PICK rows are still in the ledger (it is append-only, and the
	// history of "we took 5, then gave 5 back" must survive). What must not survive is the WALK.
	got := pickLocations(t, svc, "order:7")
	if len(got) != 0 {
		t.Fatalf("a returned pick still lists %d stops to walk to: %+v", len(got), got)
	}
}
