package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// seedLevel puts stock in a place directly — the same shape the pick tests seed with, because this
// RPC has to agree with the pick and testing it through a different door would hide a disagreement.
func seedLevel(t *testing.T, db *gorm.DB, warehouseID, productID uint64, rack *uint64, onHand int64) {
	t.Helper()

	err := db.Exec(`
		INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
		VALUES (?, ?, ?, ?, NOW())`,
		warehouseID, productID, rack, onHand,
	).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
}

func availabilityOf(res *inventoryv1.StockAvailabilityResponse, productID uint64) (int64, bool) {
	for _, item := range res.GetItems() {
		if item.GetProductId() == productID {
			return item.GetAvailable(), true
		}
	}

	return 0, false
}

// Availability is the sum over EVERY place in the warehouse, because a pick drains all of them. A
// per-shelf figure would refuse an order the warehouse can plainly fill from two shelves.
func TestStockAvailability_SumsEveryPlaceInTheWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	shelf := insertRack(t, db, warehouseA, "A-01-3")

	seedLevel(t, db, warehouseA, productX, nil, 3)    // unplaced
	seedLevel(t, db, warehouseA, productX, &shelf, 4) // and on a shelf

	res, err := svc.StockAvailability(ctx, connect.NewRequest(&inventoryv1.StockAvailabilityRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockAvailability: %v", err)
	}

	got, ok := availabilityOf(res.Msg, productX)
	if !ok {
		t.Fatalf("product %d missing from the response", productX)
	}
	if got != 7 {
		t.Fatalf("available = %d, want 7 (3 unplaced + 4 shelved)", got)
	}
}

// The whole point of this RPC: what it reports is what the pick then finds. If these two ever diverge
// the order form starts lying, so they are asserted against each other rather than against a constant.
func TestStockAvailability_AgreesWithWhatAPickCanTake(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	shelf := insertRack(t, db, warehouseA, "A-01-3")
	seedLevel(t, db, warehouseA, productX, &shelf, 5)

	res, err := svc.StockAvailability(ctx, connect.NewRequest(&inventoryv1.StockAvailabilityRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockAvailability: %v", err)
	}

	available, _ := availabilityOf(res.Msg, productX)

	// Exactly what it promised goes through.
	_, err = svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, Ref: "order-1",
		Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: available}},
	}))
	if err != nil {
		t.Fatalf("picking the %d it reported as available failed: %v", available, err)
	}

	// And the next unit does not — the figure was the true ceiling, not an approximation.
	_, err = svc.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, Ref: "order-2",
		Lines: []*inventoryv1.StockPickLine{{ProductId: productX, Quantity: 1}},
	}))
	if err == nil {
		t.Fatal("picking one more than it reported succeeded — the figure understates what a pick takes")
	}
}

// A product the warehouse holds none of comes back as a ZERO ROW, not as a gap. The caller is deciding
// whether it may promise goods to a buyer, and "none" must not have to be inferred from silence — that
// is what a partial answer looks like too.
func TestStockAvailability_ReportsZeroForAProductWithNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const (
		sellingTeam uint64 = 2
		// A product this warehouse has never held — the "nothing to report" case.
		productY uint64 = 401
	)

	seedLevel(t, db, warehouseA, productX, nil, 2)

	res, err := svc.StockAvailability(ctx, connect.NewRequest(&inventoryv1.StockAvailabilityRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, ProductIds: []uint64{productX, productY},
	}))
	if err != nil {
		t.Fatalf("StockAvailability: %v", err)
	}

	if len(res.Msg.GetItems()) != 2 {
		t.Fatalf("got %d rows for 2 ids, want 2", len(res.Msg.GetItems()))
	}

	got, ok := availabilityOf(res.Msg, productY)
	if !ok {
		t.Fatalf("product %d absent — a product with nothing must still get a row", productY)
	}
	if got != 0 {
		t.Fatalf("available for an unstocked product = %d, want 0", got)
	}
}

// Stock in ANOTHER warehouse is not available here. Stock is held per building, and the order names
// the building it ships from.
func TestStockAvailability_IsPerWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	seedLevel(t, db, warehouseB, productX, nil, 9)

	res, err := svc.StockAvailability(ctx, connect.NewRequest(&inventoryv1.StockAvailabilityRequest{
		TeamId: sellingTeam, WarehouseId: warehouseA, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockAvailability: %v", err)
	}

	got, _ := availabilityOf(res.Msg, productX)
	if got != 0 {
		t.Fatalf("warehouse A reports %d for stock that is in warehouse B, want 0", got)
	}
}
