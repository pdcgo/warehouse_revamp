package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #70/#149 — a return puts the stock back EXACTLY where the pick took it from, including the split
// across shelves the drain order produced. That is why it reverses the recorded movements rather than
// a quantity the caller supplies: a caller's own numbers could disagree with what was actually taken.
func TestStockReturn_PutsStockBackWhereItCameFrom(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	rackA := insertRack(t, db, warehouseA, "A-01-3")
	rackB := insertRack(t, db, warehouseA, "B-02-1")

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

	// Draws 3 unplaced + 4 from A-01-3 + 3 from B-02-1.
	_, err := svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, Ref: "order-77",
		Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: 10}},
	}))
	if err != nil {
		t.Fatalf("pick: %v", err)
	}

	res, err := svc.StockReturn(ctx, connect.NewRequest(&inventoryv1.StockReturnRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, Ref: "order-77",
	}))
	if err != nil {
		t.Fatalf("return: %v", err)
	}

	// One RETURN per place the pick drew from — not one lump.
	if got := res.Msg.GetMovements(); len(got) != 3 {
		t.Fatalf("returned to %d places, want 3: %+v", len(got), got)
	}

	// Every place is exactly as it started. This is the claim worth testing: not "the total is back"
	// but "each shelf is back", which a quantity-based return could get wrong while still balancing.
	for _, c := range []struct {
		rack *uint64
		want int64
	}{{nil, 3}, {&rackA, 4}, {&rackB, 100}} {
		if on := placeOnHand(t, db, warehouseA, productX, c.rack); on != c.want {
			t.Fatalf("place %v holds %d, want %d — the return did not restore the split", c.rack, on, c.want)
		}
	}
}

// #70/#149 — returning twice would CREATE stock: the second pass has nothing left to reverse but would
// add anyway. This guard is what makes a retrying caller safe, and it is the one worth getting right.
func TestStockReturn_RefusesToReturnTwice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	err := db.Exec(`
		INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
		VALUES (?, ?, NULL, ?, NOW())`,
		warehouseA, productX, 10,
	).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err = svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: 2, WarehouseId: warehouseA, Ref: "order-78",
		Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: 4}},
	}))
	if err != nil {
		t.Fatalf("pick: %v", err)
	}

	_, err = svc.StockReturn(ctx, connect.NewRequest(&inventoryv1.StockReturnRequest{
		TeamId: 2, WarehouseId: warehouseA, Ref: "order-78",
	}))
	if err != nil {
		t.Fatalf("first return: %v", err)
	}

	_, err = svc.StockReturn(ctx, connect.NewRequest(&inventoryv1.StockReturnRequest{
		TeamId: 2, WarehouseId: warehouseA, Ref: "order-78",
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("second return = %v, want FailedPrecondition", code)
	}

	// And the refusal did not add anything: 10 is what we started with, not 14.
	if on := placeOnHand(t, db, warehouseA, productX, nil); on != 10 {
		t.Fatalf("a double return created stock: %d on hand, want 10", on)
	}
}

// #70/#149 — a reference that never picked anything is NotFound, not a silent success. "The stock is
// back" must not be true when none ever left.
func TestStockReturn_UnknownRefIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	_, err := svc.StockReturn(ctx, connect.NewRequest(&inventoryv1.StockReturnRequest{
		TeamId: 2, WarehouseId: warehouseA, Ref: "order-that-never-picked",
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("unknown ref = %v, want NotFound", code)
	}
}
