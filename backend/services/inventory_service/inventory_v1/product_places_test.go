package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #156 — WHICH RACKS ALREADY HOLD THIS PRODUCT, so a put-away adds to the existing pile rather than starting a second
// one in another aisle. Racks by label — the same order the pick walk uses (#151).
func TestProductPlaces_ListsEveryRackHoldingTheProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Created out of label order on purpose: the answer must follow the LABEL, not the id.
	rackB := insertRack(t, db, warehouseA, "B-02-1")
	rackA := insertRack(t, db, warehouseA, "A-01-3")

	seedLevel(t, db, warehouseA, productX, &rackA, 40)
	seedLevel(t, db, warehouseA, productX, &rackB, 7)

	res, err := svc.ProductPlaces(ctxUser(1), connect.NewRequest(&inventoryv1.ProductPlacesRequest{
		WarehouseId: warehouseA, Filter: &inventoryv1.ProductPlacesFilter{Ids: []uint64{productX}},
	}))
	if err != nil {
		t.Fatalf("ProductPlaces: %v", err)
	}

	got := productPlacesList(res.Msg)
	if len(got) != 2 {
		t.Fatalf("the product sits on 2 racks, got %d: %+v", len(got), got)
	}

	if got[0].GetRackCode() != "a-01-3" || got[0].GetOnHand() != 40 || got[0].GetRackId() != rackA {
		t.Fatalf("first = %q holding %d, want A-01-3 holding 40", got[0].GetRackCode(), got[0].GetOnHand())
	}

	if got[1].GetRackCode() != "b-02-1" || got[1].GetOnHand() != 7 {
		t.Fatalf("second = %q holding %d, want B-02-1 holding 7", got[1].GetRackCode(), got[1].GetOnHand())
	}
}

// #156 — an EMPTY rack is not a recommendation: a rack that used to hold the product holds nothing now.
func TestProductPlaces_SkipsRacksHoldingNone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	full := insertRack(t, db, warehouseA, "A-01-1")
	empty := insertRack(t, db, warehouseA, "A-01-2")

	seedLevel(t, db, warehouseA, productX, &full, 5)
	seedLevel(t, db, warehouseA, productX, &empty, 0)

	res, err := svc.ProductPlaces(ctxUser(1), connect.NewRequest(&inventoryv1.ProductPlacesRequest{
		WarehouseId: warehouseA, Filter: &inventoryv1.ProductPlacesFilter{Ids: []uint64{productX}},
	}))
	if err != nil {
		t.Fatalf("ProductPlaces: %v", err)
	}

	got := productPlacesList(res.Msg)
	if len(got) != 1 || got[0].GetRackCode() != "a-01-1" {
		t.Fatalf("got %+v, want only the rack that actually holds some", got)
	}
}

// #156 — several products at once, because the Accept screen asks about a whole delivery, and one warehouse's racks
// never appear in another's answer.
func TestProductPlaces_ManyProductsAndScopedToTheWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const productY, otherWarehouse uint64 = 301, 960

	mine := insertRack(t, db, warehouseA, "A-01-1")
	theirs := insertRack(t, db, otherWarehouse, "Z-99-9")

	seedLevel(t, db, warehouseA, productX, &mine, 5)
	seedLevel(t, db, warehouseA, productY, &mine, 5)
	seedLevel(t, db, otherWarehouse, productX, &theirs, 5)

	res, err := svc.ProductPlaces(ctxUser(1), connect.NewRequest(&inventoryv1.ProductPlacesRequest{
		WarehouseId: warehouseA, Filter: &inventoryv1.ProductPlacesFilter{Ids: []uint64{productX, productY}},
	}))
	if err != nil {
		t.Fatalf("ProductPlaces: %v", err)
	}

	got := productPlacesList(res.Msg)
	if len(got) != 2 {
		t.Fatalf("got %d places, want one per product in THIS warehouse: %+v", len(got), got)
	}

	for _, p := range got {
		if p.GetRackCode() == "z-99-9" {
			t.Fatalf("another warehouse's rack leaked into the answer: %+v", got)
		}
	}
}
