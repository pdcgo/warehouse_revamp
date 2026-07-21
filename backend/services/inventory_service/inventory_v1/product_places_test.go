package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #156 — WHICH SHELVES ALREADY HOLD THIS PRODUCT, so a put-away adds to the existing pile rather than
// starting a second one in another aisle.
//
// The unplaced pile is IN the answer: "there are already 12 of these unshelved" is exactly the fact
// that stops someone shelving a fresh delivery separately from the one that arrived yesterday.
func TestProductPlaces_ListsEveryShelfHoldingTheProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Created out of label order on purpose: the answer must follow the LABEL, not the id.
	rackB := insertRack(t, db, warehouseA, "B-02-1")
	rackA := insertRack(t, db, warehouseA, "A-01-3")

	seed := func(rack *uint64, onHand int64) {
		t.Helper()

		err := db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, ?, NOW())`, warehouseA, productX, rack, onHand).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	seed(nil, 12)
	seed(&rackA, 40)
	seed(&rackB, 7)

	res, err := svc.ProductPlaces(ctxUser(1), connect.NewRequest(&inventoryv1.ProductPlacesRequest{
		WarehouseId: warehouseA, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("ProductPlaces: %v", err)
	}

	got := res.Msg.GetPlaces()
	if len(got) != 3 {
		t.Fatalf("the product sits in 3 places, got %d: %+v", len(got), got)
	}

	// Unplaced first, then shelves by label — the same order the pick walk uses (#151).
	if got[0].GetRackId() != 0 || got[0].GetOnHand() != 12 {
		t.Fatalf("first = rack %d holding %d, want the unplaced pile holding 12",
			got[0].GetRackId(), got[0].GetOnHand())
	}
	if got[1].GetRackCode() != "A-01-3" || got[1].GetOnHand() != 40 {
		t.Fatalf("second = %q holding %d, want A-01-3 holding 40", got[1].GetRackCode(), got[1].GetOnHand())
	}
	if got[2].GetRackCode() != "B-02-1" || got[2].GetOnHand() != 7 {
		t.Fatalf("third = %q holding %d, want B-02-1 holding 7", got[2].GetRackCode(), got[2].GetOnHand())
	}
}

// #156 — an EMPTY shelf is not a recommendation.
//
// A rack that used to hold the product holds nothing now, and suggesting it would send somebody to an
// empty space wondering what they were meant to find there.
func TestProductPlaces_SkipsShelvesHoldingNone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	full := insertRack(t, db, warehouseA, "A-01-1")
	empty := insertRack(t, db, warehouseA, "A-01-2")

	for _, c := range []struct {
		rack   uint64
		onHand int64
	}{{full, 5}, {empty, 0}} {
		err := db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, ?, NOW())`, warehouseA, productX, c.rack, c.onHand).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	res, err := svc.ProductPlaces(ctxUser(1), connect.NewRequest(&inventoryv1.ProductPlacesRequest{
		WarehouseId: warehouseA, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("ProductPlaces: %v", err)
	}

	got := res.Msg.GetPlaces()
	if len(got) != 1 {
		t.Fatalf("got %d places, want only the one holding stock: %+v", len(got), got)
	}
	if got[0].GetRackCode() != "A-01-1" {
		t.Fatalf("recommended %q, want the shelf that actually holds some", got[0].GetRackCode())
	}
}

// #156 — several products at once, because the Accept screen asks about a whole delivery, and one
// warehouse's shelves never appear in another's answer.
func TestProductPlaces_ManyProductsAndScopedToTheWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const productY, otherWarehouse uint64 = 301, 960

	mine := insertRack(t, db, warehouseA, "A-01-1")
	theirs := insertRack(t, db, otherWarehouse, "Z-99-9")

	for _, c := range []struct {
		warehouse, product uint64
		rack               uint64
	}{{warehouseA, productX, mine}, {warehouseA, productY, mine}, {otherWarehouse, productX, theirs}} {
		err := db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, 5, NOW())`, c.warehouse, c.product, c.rack).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	res, err := svc.ProductPlaces(ctxUser(1), connect.NewRequest(&inventoryv1.ProductPlacesRequest{
		WarehouseId: warehouseA, ProductIds: []uint64{productX, productY},
	}))
	if err != nil {
		t.Fatalf("ProductPlaces: %v", err)
	}

	got := res.Msg.GetPlaces()
	if len(got) != 2 {
		t.Fatalf("got %d places, want one per product in THIS warehouse: %+v", len(got), got)
	}

	for _, p := range got {
		if p.GetRackCode() == "Z-99-9" {
			t.Fatalf("another warehouse's shelf leaked into the answer: %+v", got)
		}
	}
}
