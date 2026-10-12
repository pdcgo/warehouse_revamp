package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #149 — a pick drains the UNPLACED pile first, then shelves by label, spreading across places until
// the line is filled. The drain order is the owner's call; what matters technically is that the LEDGER
// records which shelves were actually emptied, so a picker later reads the truth rather than a guess.
func TestStockPick_DrainsUnplacedFirstThenShelvesByLabel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	// Created out of label order on purpose: the drain must follow the LABEL, not the id.
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

	seed(nil, 3)      // unplaced — should go first
	seed(&rackA, 4)   // A-01-3 — then this
	seed(&rackB, 100) // B-02-1 — then this, and only for the remainder

	// 10 needed: 3 unplaced + 4 from A-01-3 + 3 from B-02-1.
	res, err := svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, Ref: "order-42",
		Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: 10}},
	}))
	if err != nil {
		t.Fatalf("StockPick: %v", err)
	}

	// One movement per PLACE drawn, in drain order — this is the audit trail.
	got := res.Msg.GetMovements()
	if len(got) != 3 {
		t.Fatalf("drew from 3 places, got %d movements: %+v", len(got), got)
	}

	for i, want := range []struct {
		rack  uint64
		delta int64
	}{{0, -3}, {rackA, -4}, {rackB, -3}} {
		if got[i].GetRackId() != want.rack || got[i].GetDelta() != want.delta {
			t.Fatalf("movement %d = rack %d delta %d, want rack %d delta %d",
				i, got[i].GetRackId(), got[i].GetDelta(), want.rack, want.delta)
		}
	}

	// The places hold what the movements said.
	for _, c := range []struct {
		rack *uint64
		want int64
	}{{nil, 0}, {&rackA, 0}, {&rackB, 97}} {
		if on := placeOnHand(t, db, warehouseA, productX, c.rack); on != c.want {
			t.Fatalf("place %v holds %d, want %d", c.rack, on, c.want)
		}
	}

	// And the warehouse total fell by exactly what was taken: 107 - 10.
	if total := warehouseTotal(t, svc, ctx, warehouseA, productX); total != 97 {
		t.Fatalf("warehouse total = %d, want 97", total)
	}
}

// #149 — a warehouse that cannot fill a line refuses the WHOLE pick and takes nothing. An order must
// never end up holding part of what it asked for, with nothing saying so.
func TestStockPick_NotEnoughTakesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	shelf := insertRack(t, db, warehouseA, "A-01-3")

	err := db.Exec(`
		INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
		VALUES (?, ?, ?, ?, NOW())`,
		warehouseA, productX, shelf, 5,
	).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err = svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: 2, WarehouseId: warehouseA, Ref: "order-43",
		Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: 6}},
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("over-pick = %v, want FailedPrecondition", code)
	}

	if on := placeOnHand(t, db, warehouseA, productX, &shelf); on != 5 {
		t.Fatalf("a refused pick took stock anyway: %d on the shelf, want 5", on)
	}
}

// #149 — a MULTI-LINE pick is one transaction. If the second line cannot be filled, the first must be
// put back: an order half-picked is worse than one refused, because the ledger would say goods left the
// building for an order that never existed.
func TestStockPick_IsAtomicAcrossLines(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const productY uint64 = 400

	seed := func(product uint64, onHand int64) {
		t.Helper()

		err := db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, NULL, ?, NOW())`,
			warehouseA, product, onHand,
		).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	seed(productX, 10) // plenty
	seed(productY, 1)  // not enough for the second line

	_, err := svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: 2, WarehouseId: warehouseA, Ref: "order-44",
		Lines: []*inventoryv1.StockPickLine{
			{ProductId: productX, Quantity: 5}, // would succeed on its own
			{ProductId: productY, Quantity: 2}, // fails
		},
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("multi-line over-pick = %v, want FailedPrecondition", code)
	}

	// The FIRST line's stock is back — that is the atomicity claim, and it is the one worth testing.
	if on := placeOnHand(t, db, warehouseA, productX, nil); on != 10 {
		t.Fatalf("the succeeding line was not rolled back: %d, want 10", on)
	}
	if on := placeOnHand(t, db, warehouseA, productY, nil); on != 1 {
		t.Fatalf("the failing line took stock: %d, want 1", on)
	}

	// And no movement was left behind claiming goods moved.
	var movements int64

	err = db.Raw(`SELECT COUNT(*) FROM stock_movements WHERE ref = ?`, "order-44").Scan(&movements).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if movements != 0 {
		t.Fatalf("a refused pick left %d movements in the ledger", movements)
	}
}
