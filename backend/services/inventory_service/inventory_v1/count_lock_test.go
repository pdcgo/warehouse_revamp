package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// A COUNT STOPS EVERY MOVEMENT, SALES AND CANCELS TOO (a-lock-stops-sales-and-cancels-too). While Kaos Hitam is counted
// on Rak A (5) and Rak B (5): no put-away, move, sample or adjustment there; no order and no transfer takes from them;
// no cancel puts units back onto them — each refusal naming the count. A take still runs from a rack the count does not
// hold. Kaos Polos, beside it on Rak A, is not held. And a rack a count holds cannot be deleted
// (a-rack-a-count-holds-cannot-be-deleted).

func countKaosHitam(t *testing.T, f *opnameFixture) *inventoryv1.OpnameSession {
	t.Helper()

	return f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
}

// cancelCount releases a count — the admin calls it off.
func cancelCount(t *testing.T, f *opnameFixture, sessionID uint64) {
	t.Helper()

	_, err := f.svc.OpnameSessionCancel(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionCancelRequest{
		TeamId: otWarehouse, SessionId: sessionID,
	}))
	if err != nil {
		t.Fatalf("cancel the count: %v", err)
	}
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

// orderKaosHitam takes n Kaos Hitam for Melati under the key.
func orderKaosHitam(f *opnameFixture, key string, n int64) (*connect.Response[inventoryv1.OrderTransactionCreateResponse], error) {
	return f.svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: otMelati, IdempotencyKey: key, WarehouseId: otWarehouse,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: otKaosHitam, Quantity: n}},
	}))
}

func refusedByTheCount(t *testing.T, what string, err error) {
	t.Helper()

	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "count #") {
		t.Fatalf("%s: err = %v, want FailedPrecondition naming the count", what, err)
	}
}

func kaosHitamOn(t *testing.T, f *opnameFixture) (a, b, c int64) {
	t.Helper()

	return rackCount(t, f.db, otKaosHitam, f.rakA), rackCount(t, f.db, otKaosHitam, f.rakB), rackCount(t, f.db, otKaosHitam, f.rakC)
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

// AN ORDER ONLY A COUNTED RACK CAN FILL IS REFUSED — BEING_COUNTED, naming the line, what the other racks hold (none),
// and the count; nothing is taken, on either ledger. The rack screen still says which units the count holds.
func TestCountLock_AnOrderOnlyACountedRackHoldsIsRefused(t *testing.T) {
	f := opnameStocked(t)
	s := countKaosHitam(t, f)

	before := batchesOf(t, f, otKaosHitam)

	_, err := orderKaosHitam(f, "key-77", 1)
	refusedByTheCount(t, "an order under the count", err)

	r := refusalOf(t, err)
	if r.GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_BEING_COUNTED {
		t.Fatalf("reason %v, want BEING_COUNTED", r.GetReason())
	}

	if lines := r.GetLines(); len(lines) != 1 || lines[0].GetProductId() != otKaosHitam || lines[0].GetWanted() != 1 ||
		lines[0].GetAvailable() != 0 || lines[0].GetCountingSessionId() != s.GetId() {
		t.Fatalf("refused lines %+v, want Kaos Hitam: wants 1, 0 free, held by count #%d", lines, s.GetId())
	}

	if a, b, _ := kaosHitamOn(t, f); a != 5 || b != 5 {
		t.Fatalf("Rak A %d, B %d — want 5 and 5, nothing taken", a, b)
	}

	after := batchesOf(t, f, otKaosHitam)
	for i := range before {
		if after[i].StockCount != before[i].StockCount {
			t.Fatalf("batch %d went %d → %d — a refused take moved the batches", before[i].ID, before[i].StockCount, after[i].StockCount)
		}
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

	// Released, the same order goes.
	cancelCount(t, f, s.GetId())

	_, err = orderKaosHitam(f, "key-78", 1)
	if err != nil {
		t.Fatalf("the order after the count: %v", err)
	}
}

// A TAKE SKIPS THE COUNTED RACKS: Kaos Hitam is counted on Rak A (5) and Rak B (5); 8 more are put away on Rak C after
// the count began, outside it. An order of 1 is taken from Rak C — though A and B hold fewer — and an order of 9, more
// than Rak C holds, is refused naming the 7 it could have had.
func TestCountLock_ATakeSkipsTheCountedRacks(t *testing.T) {
	f := opnameStocked(t)
	s := countKaosHitam(t, f)

	err := restockOnto(t, f, f.rakC, 8)
	if err != nil {
		t.Fatalf("put-away onto Rak C: %v", err)
	}

	_, err = orderKaosHitam(f, "key-78", 1)
	if err != nil {
		t.Fatalf("order: %v", err)
	}

	if a, b, c := kaosHitamOn(t, f); a != 5 || b != 5 || c != 7 {
		t.Fatalf("Rak A %d, B %d, C %d — want the unit taken from C, the one rack the count does not hold", a, b, c)
	}

	_, err = orderKaosHitam(f, "key-79", 9)
	refusedByTheCount(t, "an order of 9 under the count", err)

	if lines := refusalOf(t, err).GetLines(); len(lines) != 1 || lines[0].GetAvailable() != 7 ||
		lines[0].GetCountingSessionId() != s.GetId() {
		t.Fatalf("refused lines %+v, want 7 free on Rak C, the rest held by count #%d", lines, s.GetId())
	}

	if a, b, c := kaosHitamOn(t, f); a != 5 || b != 5 || c != 7 {
		t.Fatalf("Rak A %d, B %d, C %d — the refused order moved a rack", a, b, c)
	}
}

// A CANCEL WAITS FOR THE COUNT: an order taken before the count began cannot be released while its rack is counted —
// FailedPrecondition naming the count, nothing put back. Once the count is called off, it releases.
func TestCountLock_ACancelWaitsForTheCount(t *testing.T) {
	f := opnameStocked(t)

	_, err := orderKaosHitam(f, "key-80", 1)
	if err != nil {
		t.Fatalf("order before the count: %v", err)
	}

	a, b, _ := kaosHitamOn(t, f)
	if a+b != 9 {
		t.Fatalf("Rak A %d + B %d, want 9 after the take", a, b)
	}

	s := countKaosHitam(t, f)

	release := func() (*connect.Response[inventoryv1.OrderTransactionReleaseResponse], error) {
		return f.svc.OrderTransactionRelease(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
			TeamId: otMelati, IdempotencyKey: "key-80",
		}))
	}

	_, err = release()
	refusedByTheCount(t, "a cancel under the count", err)

	if a2, b2, _ := kaosHitamOn(t, f); a2 != a || b2 != b {
		t.Fatalf("Rak A %d → %d, B %d → %d — a refused cancel put units back", a, a2, b, b2)
	}

	cancelCount(t, f, s.GetId())

	res, err := release()
	if err != nil {
		t.Fatalf("the cancel after the count: %v", err)
	}

	if !res.Msg.GetReleased() {
		t.Fatalf("the cancel after the count released nothing")
	}

	if a3, b3, _ := kaosHitamOn(t, f); a3+b3 != 10 {
		t.Fatalf("Rak A %d + B %d, want 10 once released", a3, b3)
	}
}

// A TRANSFER'S OUT-LEG AND ITS CANCEL WAIT FOR THE COUNT too — they share the order's take.
func TestCountLock_ATransferAndItsCancelWaitForTheCount(t *testing.T) {
	f := opnameStocked(t)

	create := func() (*connect.Response[inventoryv1.WarehouseTransferCreateResponse], error) {
		return f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: otWarehouse, ToWarehouseId: wtB,
			Lines: []*inventoryv1.WarehouseTransferLine{wtLine(otKaosHitam, 1)},
		}))
	}

	s := countKaosHitam(t, f)

	_, err := create()
	refusedByTheCount(t, "a transfer out under the count", err)

	cancelCount(t, f, s.GetId())

	res, err := create()
	if err != nil {
		t.Fatalf("a transfer out after the count: %v", err)
	}

	countKaosHitam(t, f)

	_, err = f.svc.WarehouseTransferCancel(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCancelRequest{
		TeamId: otMelati, TransferId: res.Msg.GetTransfer().GetId(), Description: "wrong warehouse",
	}))
	refusedByTheCount(t, "a transfer cancel under the count", err)

	if a, b, _ := kaosHitamOn(t, f); a+b != 9 {
		t.Fatalf("Rak A %d + B %d, want 9 — the refused cancel put nothing back", a, b)
	}
}

// A RACK A COUNT HOLDS IS NOT DELETED (a-rack-a-count-holds-cannot-be-deleted): Rak D's Kaos Hitam row is at 0 and in the
// count, and is refused; Rak E, outside a product count, goes. Rak F has no row at all, but an `all` count visits it, so
// it is refused too. Once the counts are called off, both go.
func TestCountLock_ARackACountHoldsIsNotDeleted(t *testing.T) {
	f := opnameStocked(t)
	rakD := newRack(t, f.svc, otWarehouse, "rak-d")
	rakE := newRack(t, f.svc, otWarehouse, "rak-e")

	err := restockOnto(t, f, rakD, 1)
	if err != nil {
		t.Fatalf("put-away onto Rak D: %v", err)
	}

	// Fewest first: Rak D's one unit goes, and its row stays at 0.
	_, err = orderKaosHitam(f, "key-81", 1)
	if err != nil {
		t.Fatalf("order: %v", err)
	}

	if d := rackCount(t, f.db, otKaosHitam, rakD); d != 0 {
		t.Fatalf("Rak D holds %d, want 0", d)
	}

	deleteRack := func(id uint64) error {
		_, delErr := f.svc.RackDelete(opAdmin(opBudi), connect.NewRequest(&inventoryv1.RackDeleteRequest{
			TeamId: otWarehouse, RackId: id,
		}))

		return delErr
	}

	s := countKaosHitam(t, f)
	refusedByTheCount(t, "deleting Rak D, its row at 0 in the count", deleteRack(rakD))

	err = deleteRack(rakE)
	if err != nil {
		t.Fatalf("Rak E, outside a product count: %v", err)
	}

	cancelCount(t, f, s.GetId())

	rakF := newRack(t, f.svc, otWarehouse, "rak-f")
	all := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_ALL, 0, 0, 0)
	refusedByTheCount(t, "deleting Rak F during an all count", deleteRack(rakF))
	refusedByTheCount(t, "deleting Rak D during an all count", deleteRack(rakD))

	cancelCount(t, f, all.GetId())

	for _, id := range []uint64{rakD, rakF} {
		err = deleteRack(id)
		if err != nil {
			t.Fatalf("rack %d after the count: %v", id, err)
		}
	}
}
