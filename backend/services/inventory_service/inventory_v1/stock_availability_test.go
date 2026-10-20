package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func availabilityOf(res *inventoryv1.StockAvailabilityResponse, productID uint64) (int64, bool) {
	for _, item := range res.GetItems() {
		if item.GetProductId() == productID {
			return item.GetAvailable(), true
		}
	}

	return 0, false
}

// Availability is the sum over EVERY rack in the warehouse, because a take drains all of them. A per-shelf figure would
// refuse an order the warehouse can plainly fill from two shelves.
func TestStockAvailability_SumsEveryRackInTheWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shelfA := insertRack(t, db, warehouseA, "A-01-3")
	shelfB := insertRack(t, db, warehouseA, "A-01-4")

	seedLevel(t, db, warehouseA, productX, &shelfA, 3)
	seedLevel(t, db, warehouseA, productX, &shelfB, 4)

	res, err := svc.StockAvailability(ctxUser(1), connect.NewRequest(&inventoryv1.StockAvailabilityRequest{
		TeamId: seedOwner, WarehouseId: warehouseA, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockAvailability: %v", err)
	}

	got, ok := availabilityOf(res.Msg, productX)
	if !ok || got != 7 {
		t.Fatalf("available = %d (present %v), want 7 — 3 + 4 across two racks", got, ok)
	}
}

// The whole point of this RPC: what it reports is what the order take then finds. If these two ever diverge the order
// form starts lying, so they are asserted against each other rather than against a constant.
func TestStockAvailability_AgreesWithWhatATakeCanTake(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shelf := insertRack(t, db, warehouseA, "A-01-3")
	seedLevel(t, db, warehouseA, productX, &shelf, 5)

	res, err := svc.StockAvailability(ctxUser(1), connect.NewRequest(&inventoryv1.StockAvailabilityRequest{
		TeamId: seedOwner, WarehouseId: warehouseA, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockAvailability: %v", err)
	}

	available, _ := availabilityOf(res.Msg, productX)

	take := func(key string, qty int64) error {
		_, takeErr := svc.OrderTransactionCreate(ctxUser(1), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
			TeamId: seedOwner, IdempotencyKey: key, WarehouseId: warehouseA,
			Lines: []*inventoryv1.OrderTransactionLine{{ProductId: productX, Quantity: qty}},
		}))

		return takeErr
	}

	// Exactly what it promised goes through...
	err = take("order:1", available)
	if err != nil {
		t.Fatalf("taking the %d it reported as available failed: %v", available, err)
	}

	// ...and the next unit does not — the figure was the true ceiling, not an approximation.
	err = take("order:2", 1)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("taking one more than it reported: err = %v, want FailedPrecondition", err)
	}
}

// A product the warehouse holds none of comes back as a ZERO ROW, not as a gap. The caller is deciding whether it may
// promise goods to a buyer, and "none" must not have to be inferred from silence — that is what a partial answer looks
// like too.
func TestStockAvailability_ReportsZeroForAProductWithNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// A product this warehouse has never held — the "nothing to report" case.
	const productY uint64 = 401

	seedLevel(t, db, warehouseA, productX, nil, 2)

	res, err := svc.StockAvailability(ctxUser(1), connect.NewRequest(&inventoryv1.StockAvailabilityRequest{
		TeamId: seedOwner, WarehouseId: warehouseA, ProductIds: []uint64{productX, productY},
	}))
	if err != nil {
		t.Fatalf("StockAvailability: %v", err)
	}

	if len(res.Msg.GetItems()) != 2 {
		t.Fatalf("got %d rows for 2 ids, want 2", len(res.Msg.GetItems()))
	}

	if got, ok := availabilityOf(res.Msg, productX); !ok || got != 2 {
		t.Fatalf("available for product X = %d, want 2", got)
	}

	got, ok := availabilityOf(res.Msg, productY)
	if !ok || got != 0 {
		t.Fatalf("product %d = %d (present %v) — a product with nothing must still get a row, at 0", productY, got, ok)
	}
}

// Stock in ANOTHER warehouse is not available here. Stock is held per building, and the order names the building it
// ships from.
func TestStockAvailability_IsPerWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	seedLevel(t, db, warehouseB, productX, nil, 9)

	res, err := svc.StockAvailability(ctxUser(1), connect.NewRequest(&inventoryv1.StockAvailabilityRequest{
		TeamId: seedOwner, WarehouseId: warehouseA, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockAvailability: %v", err)
	}

	if got, _ := availabilityOf(res.Msg, productX); got != 0 {
		t.Fatalf("warehouse A reports %d for stock that is in warehouse B, want 0", got)
	}
}
