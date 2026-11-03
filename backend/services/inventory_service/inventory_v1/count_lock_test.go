package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// A LOCK STOPS UNITS MOVING, NOT SALES (a-lock-stops-units-moving-not-sales). While Kaos Hitam is counted on Rak A and
// Rak B: no put-away, move, sample or adjustment there, each refusal naming the count — and an order is still taken,
// from the racks the count does not hold first, its pick on a held rack marked as waiting. Kaos Polos, beside it on Rak A,
// is not held.

func countKaosHitam(t *testing.T, f *opnameFixture) *inventoryv1.OpnameSession {
	t.Helper()

	return f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
}

// restockOnto puts n new Kaos Hitam on a rack — a put-away.
func restockOnto(t *testing.T, f *opnameFixture, rack uint64, n int64) error {
	t.Helper()

	created, err := f.svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otMelati, WarehouseId: otWarehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: otKaosHitam, ProductCode: "KH-01", Name: "Kaos Hitam", Count: n, Total: float64(n) * 10000}},
	}))
	if err != nil {
		t.Fatalf("restock: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = f.svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: otWarehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: n,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: n}},
		}},
	}))

	return err
}

func refusedByTheCount(t *testing.T, what string, err error) {
	t.Helper()

	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "being counted") ||
		!strings.Contains(err.Error(), "count #") {
		t.Fatalf("%s: err = %v, want FailedPrecondition naming the count", what, err)
	}
}

func TestCountLock_RefusesSampleAdjustAndPutAway(t *testing.T) {
	f := opnameStocked(t)
	countKaosHitam(t, f)

	err := f.moveOne(otKaosHitam, f.rakA, f.rakC)
	refusedByTheCount(t, "a move off Rak A", err)

	_, err = f.svc.RackSample(opStaff(opAni), connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: otWarehouse, RackId: f.rakA, Recipient: "Budi",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: otKaosHitam, Quantity: 1}},
	}))
	refusedByTheCount(t, "a sample", err)

	_, err = f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: otWarehouse, ProductId: otKaosHitam, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakA},
		OnHand: 4, Reason: "recount",
	}))
	refusedByTheCount(t, "a recount", err)

	b1 := batchesOf(t, f, otKaosHitam)[0]

	_, err = f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: otWarehouse, ProductId: otKaosHitam, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakA},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, BatchId: b1.ID, Quantity: 1, Reason: "dropped",
	}))
	refusedByTheCount(t, "a damaged report", err)

	// A put-away onto Rak A is refused; onto a rack the count does not hold it goes.
	refusedByTheCount(t, "a put-away onto Rak A", restockOnto(t, f, f.rakA, 2))

	err = restockOnto(t, f, f.rakC, 2)
	if err != nil {
		t.Fatalf("a put-away onto a rack outside the count: %v", err)
	}

	// Kaos Polos beside it on Rak A is not counted, and moves.
	err = f.moveOne(otKaosPolos, f.rakA, f.rakC)
	if err != nil {
		t.Fatalf("Kaos Polos, not counted: %v", err)
	}
}

// The order is still taken from racks the count holds, when nothing else holds the product — and its pick is marked as
// waiting. The rack screen says which units the count holds.
func TestCountLock_AnOrderIsStillTakenAndItsPickWaits(t *testing.T) {
	f := opnameStocked(t)
	s := countKaosHitam(t, f)

	res, err := f.svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: otMelati, IdempotencyKey: "order:77", WarehouseId: otWarehouse,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: otKaosHitam, Quantity: 1}},
	}))
	if err != nil {
		t.Fatalf("an order under the count: %v", err)
	}

	if res.Msg.GetTransactionId() == 0 {
		t.Fatalf("no take")
	}

	picks, err := f.svc.StockPickLocations(opStaff(opAni), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
		WarehouseId: otWarehouse, Ref: "order:77",
	}))
	if err != nil {
		t.Fatalf("pick locations: %v", err)
	}

	if locs := picks.Msg.GetLocations(); len(locs) != 1 || locs[0].GetCountingSessionId() != s.GetId() {
		t.Fatalf("pick %+v, want one shelf, held by count #%d — the picker waits", locs, s.GetId())
	}

	stock, err := f.svc.RackStock(opStaff(opAni), connect.NewRequest(&inventoryv1.RackStockRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.RackStockFilter{RackId: f.rakA}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("rack stock: %v", err)
	}

	counting := map[uint64]bool{}
	for _, item := range stock.Msg.GetItems() {
		for _, line := range item.GetRackStock().GetMapData() {
			counting[line.GetProductId()] = line.GetCounting()
		}
	}

	if !counting[otKaosHitam] || counting[otKaosPolos] {
		t.Fatalf("counting %v, want Kaos Hitam held on Rak A and Kaos Polos not", counting)
	}
}

// Fewest first, AMONG THE RACKS THE COUNT DOES NOT HOLD: Kaos Hitam is counted on Rak A (5) and Rak B (5); 8 more are
// put away on Rak C after the count began, outside it. An order of 1 is taken from Rak C — though A and B hold fewer.
func TestCountLock_ATakePrefersTheRacksNotCounted(t *testing.T) {
	f := opnameStocked(t)
	countKaosHitam(t, f)

	err := restockOnto(t, f, f.rakC, 8)
	if err != nil {
		t.Fatalf("put-away onto Rak C: %v", err)
	}

	_, err = f.svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: otMelati, IdempotencyKey: "order:78", WarehouseId: otWarehouse,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: otKaosHitam, Quantity: 1}},
	}))
	if err != nil {
		t.Fatalf("order: %v", err)
	}

	if a, b, c := rackCount(t, f.db, otKaosHitam, f.rakA), rackCount(t, f.db, otKaosHitam, f.rakB), rackCount(t, f.db, otKaosHitam, f.rakC); a != 5 || b != 5 || c != 7 {
		t.Fatalf("Rak A %d, B %d, C %d — want the unit taken from C, the one rack the count does not hold", a, b, c)
	}
}
