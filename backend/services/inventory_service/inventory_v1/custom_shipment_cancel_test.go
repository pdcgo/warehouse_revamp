package inventory_v1_test

import (
	"errors"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// Melati calls its sample to Budi off while it is still Diminta: the take is undone ONCE — Kaos Hitam's 3 units back on
// Rak A and into batch 1 (2 at Rp 10.000) and batch 2 (1 at Rp 12.000), Kaos Polos back on Rak B — the take marked rolled
// back, the pick page's racks netting to nothing, and the courier's Rp 15.000 given back to account 77
// (a-custom-shipment-is-cancelled-only-while-requested, a-rollback-reverses-its-log-rows).
func TestCustomShipmentCancel_ASamplesUnitsGoBackOnTheRacksTheyLeft(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 3), csProduct(wtKaosPolos, 1)))

	cs, err := f.cancel(otMelati, created.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	wantStatus(t, cs, inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_CANCELLED)

	if cs.GetCancelledByUserId() != wtSeller || cs.GetCancelledAtUnix() == 0 {
		t.Fatalf("cancelled by %d at %d, want by %d", cs.GetCancelledByUserId(), cs.GetCancelledAtUnix(), wtSeller)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 7 || r != 7 {
		t.Fatalf("A holds %d / %d Kaos Hitam after the cancel, want all 7 back", b, r)
	}

	if a, b := rackCount(t, f.db, wtKaosHitam, f.rakA), rackCount(t, f.db, wtKaosHitam, f.rakB); a != 3 || b != 4 {
		t.Fatalf("Kaos Hitam on Rak A %d, Rak B %d — want 3 and 4, back where they were", a, b)
	}

	if b := rackCount(t, f.db, wtKaosPolos, f.rakB); b != 4 {
		t.Fatalf("Kaos Polos on Rak B %d, want 4", b)
	}

	// Each batch gets back exactly the units and value it gave up.
	var batches []models.Batch
	f.db.Where("warehouse_id = ? AND product_id = ?", wtA, wtKaosHitam).Order("id").Find(&batches)

	if len(batches) != 2 || batches[0].StockCount != 2 || batches[0].StockValuation != 20000 ||
		batches[1].StockCount != 5 || batches[1].StockValuation != 60000 {
		t.Fatalf("Kaos Hitam batches = %+v, want 2 at 20000 and 5 at 60000", batches)
	}

	var take models.InventoryTransaction
	f.db.First(&take, cs.GetTransactionId())

	if !take.IsRollback || take.TxType != models.TxSample {
		t.Fatalf("the sample's take = %+v, want a sample marked rolled back", take)
	}

	// Undone once: per product, the batch rows and the rack rows the take wrote net to nothing.
	if rows := takeNetRows(t, f.db, take.ID); len(rows) != 0 {
		t.Fatalf("the rolled-back take still moves %v", rows)
	}

	picks, err := f.svc.StockPickLocations(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
		WarehouseId: wtA, TransactionId: cs.GetTransactionId(),
	}))
	if err != nil {
		t.Fatalf("pick locations: %v", err)
	}

	for _, loc := range picks.Msg.GetLocations() {
		if loc.GetQuantity() != 0 {
			t.Fatalf("the cancelled take still asks to pick %+v", loc)
		}
	}

	if logs := cs.GetLogs(); len(logs) != 2 ||
		logs[1].GetFromStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED ||
		logs[1].GetToStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_CANCELLED ||
		logs[1].GetActorUserId() != wtSeller {
		t.Fatalf("trail = %+v, want requested, then requested → cancelled by %d", logs, wtSeller)
	}

	events := f.customShipmentEvents()
	last := events[len(events)-1]
	got := last.GetCustomShipmentCancelled()

	if last.GetEventId() != "custom-shipment-cancelled:"+itoa(cs.GetId()) || got == nil ||
		got.GetFinanceAccountId() != wtAccount || got.GetAmount() != 15000 || got.GetTeamId() != otMelati ||
		got.GetWarehouseId() != wtA || got.GetActorId() != wtSeller ||
		got.GetKind() != inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE ||
		got.GetPayer() != inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM || got.GetCancelledAtUnix() == 0 {
		t.Fatalf("event %s = %+v, want Melati's sample cancelled, Rp 15.000 back to account 77", last.GetEventId(), got)
	}
}

// A reship moved no stock, so its cancel moves none: the parcel is cancelled and its broken units are free for another
// reship. A warehouse payer had nothing posted — the event gives back 0 from no account.
func TestCustomShipmentCancel_AReshipsBrokenUnitsAreFreeAgain(t *testing.T) {
	f := csStocked(t)
	first := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 3)))

	_, err := f.create(f.csReship("r-2", csRestockLine(f.line[csWidget], 1)))
	wantCode(t, err, connect.CodeFailedPrecondition, "a 4th broken Widget while 3 are on the way back")

	var transactions int64
	f.db.Model(&models.InventoryTransaction{}).Count(&transactions)

	cs, err := f.cancel(otMelati, first.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	wantStatus(t, cs, inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_CANCELLED)

	var after int64
	f.db.Model(&models.InventoryTransaction{}).Count(&after)

	if after != transactions {
		t.Fatalf("a reship's cancel wrote %d stock transactions, want none", after-transactions)
	}

	got := f.customShipmentEvents()[len(f.customShipmentEvents())-1].GetCustomShipmentCancelled()
	if got == nil || got.GetFinanceAccountId() != 0 || got.GetAmount() != 0 ||
		got.GetKind() != inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP ||
		got.GetPayer() != inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE {
		t.Fatalf("event = %+v, want the reship cancelled with nothing to give back", got)
	}

	f.mustCreate(t, f.csReship("r-3", csRestockLine(f.line[csWidget], 3)))
}

// Only the owning selling team cancels — the warehouse and another team read NotFound — and only while Diminta: once
// picked, or once cancelled, it is refused and nothing moves.
func TestCustomShipmentCancel_OnlyTheOwningTeamOnlyWhileRequested(t *testing.T) {
	f := csStocked(t)
	cs := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 3)))

	_, err := f.cancel(wtA, cs.GetId())
	wantCode(t, err, connect.CodeNotFound, "cancelled by the warehouse")

	_, err = f.cancel(otSinar, cs.GetId())
	wantCode(t, err, connect.CodeNotFound, "cancelled by another selling team")

	f.mustPick(t, cs.GetId())
	events := len(f.customShipmentEvents())

	_, err = f.cancel(otMelati, cs.GetId())
	wantCode(t, err, connect.CodeFailedPrecondition, "cancelled once picked")

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 4 || r != 4 {
		t.Fatalf("A holds %d / %d Kaos Hitam, want 4 — a refused cancel put units back", b, r)
	}

	var take models.InventoryTransaction
	f.db.First(&take, cs.GetTransactionId())

	if take.IsRollback || len(f.customShipmentEvents()) != events {
		t.Fatalf("a refused cancel rolled the take back (%v) or published", take.IsRollback)
	}

	// Cancelled once — a second cancel is refused and puts nothing back twice.
	other := f.mustCreate(t, csSample("k-2", csProduct(wtKaosPolos, 2)))

	_, err = f.cancel(otMelati, other.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err = f.cancel(otMelati, other.GetId())
	wantCode(t, err, connect.CodeFailedPrecondition, "cancelled twice")

	if b, r := unitsAt(t, f.db, wtA, wtKaosPolos); b != 4 || r != 4 {
		t.Fatalf("A holds %d / %d Kaos Polos, want 4 — back once", b, r)
	}

	// A reship once picked is past its cancel too — it moved no stock, so only the status rule stops it.
	reship := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 1)))
	f.mustPick(t, reship.GetId())

	_, err = f.cancel(otMelati, reship.GetId())
	wantCode(t, err, connect.CodeFailedPrecondition, "a reship cancelled once picked")
}

// A CANCEL WAITS FOR THE COUNT (a-lock-stops-sales-and-cancels-too): while Kaos Hitam is counted, putting a cancelled
// sample's units back onto the counted racks is refused, naming the count — the parcel stays Diminta and the units stay
// out. Once the count is called off, the cancel puts them back.
func TestCustomShipmentCancel_WaitsForTheCount(t *testing.T) {
	f := opnameStocked(t)

	created, err := f.svc.CustomShipmentCreate(ctxUser(wtSeller), connect.NewRequest(csSample("k-1", csProduct(otKaosHitam, 2))))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetCustomShipment().GetId()

	cancel := func() error {
		_, cancelErr := f.svc.CustomShipmentCancel(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentCancelRequest{
			TeamId: otMelati, Id: id,
		}))

		return cancelErr
	}

	s := countKaosHitam(t, f)

	refusedByTheCount(t, "a sample's cancel under the count", cancel())

	if a, b, _ := kaosHitamOn(t, f); a+b != 8 {
		t.Fatalf("Rak A %d + B %d, want 8 — the refused cancel put nothing back", a, b)
	}

	var stored models.CustomShipment
	f.db.First(&stored, id)

	if stored.Status != models.CustomShipmentRequested {
		t.Fatalf("the parcel is %s after a refused cancel, want requested", stored.Status)
	}

	cancelCount(t, f, s.GetId())

	err = cancel()
	if err != nil {
		t.Fatalf("cancel after the count: %v", err)
	}

	if a, b, _ := kaosHitamOn(t, f); a+b != 10 {
		t.Fatalf("Rak A %d + B %d, want 10 once cancelled", a, b)
	}
}

// THE UNDO'S GUARD: RollbackParcelSample reaches a take only through a REQUESTED sample parcel — a picked parcel, a
// reship and a parcel row pointing at an order's take are refused and nothing moves; RollbackTake's own guard still
// refuses every sample, a parcel's included (an in-person sample stays final, a-handed-over-sample-is-final).
func TestRollbackParcelSample_OnlyARequestedParcelsSample(t *testing.T) {
	f := csStocked(t)

	picked := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 2)))
	f.mustPick(t, picked.GetId())

	_, err := inventory_mutations.RollbackParcelSample(f.db, picked.GetId(), wtSeller)
	if !errors.Is(err, inventory_mutations.ErrNotARequestedParcelSample) {
		t.Fatalf("undo a picked parcel's take: err = %v, want ErrNotARequestedParcelSample", err)
	}

	reship := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 1)))

	_, err = inventory_mutations.RollbackParcelSample(f.db, reship.GetId(), wtSeller)
	if !errors.Is(err, inventory_mutations.ErrNotARequestedParcelSample) {
		t.Fatalf("undo a reship: err = %v, want ErrNotARequestedParcelSample", err)
	}

	requested := f.mustCreate(t, csSample("k-2", csProduct(wtKaosPolos, 1)))

	_, err = inventory_mutations.RollbackTake(f.db, requested.GetTransactionId(), wtSeller)
	if !errors.Is(err, inventory_mutations.ErrNotATake) {
		t.Fatalf("RollbackTake on a parcel's sample: err = %v, want ErrNotATake (its guard untouched)", err)
	}

	// A parcel row pointing at a take that is not its sample (an order's) is refused — the undo never reaches it.
	order, err := f.svc.OrderTransactionCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: otMelati, IdempotencyKey: "key-guard", WarehouseId: wtA,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: wtKaosHitam, Quantity: 1}},
	}))
	if err != nil {
		t.Fatalf("order: %v", err)
	}

	err = f.db.Exec(`UPDATE custom_shipments SET transaction_id = ? WHERE id = ?`, order.Msg.GetTransactionId(), requested.GetId()).Error
	if err != nil {
		t.Fatalf("point the parcel at the order's take: %v", err)
	}

	_, err = inventory_mutations.RollbackParcelSample(f.db, requested.GetId(), wtSeller)
	if !errors.Is(err, inventory_mutations.ErrNotARequestedParcelSample) {
		t.Fatalf("undo an order's take through a parcel: err = %v, want ErrNotARequestedParcelSample", err)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 4 || r != 4 {
		t.Fatalf("A holds %d / %d Kaos Hitam, want 4 — a refused undo moved units", b, r)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosPolos); b != 3 || r != 3 {
		t.Fatalf("A holds %d / %d Kaos Polos, want 3 — a refused undo moved units", b, r)
	}
}
