package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ── the sample ──────────────────────────────────────────────────────────────────────────────────────────────────────

// Melati sends Budi Kaos Hitam × 3 and Kaos Polos × 1 as a sample, paying the courier Rp 15.000 from account 77. The
// units leave stock AT CREATE in ONE `sample` transaction of Melati's that keeps Budi's name — batch 1's two units at
// Rp 10.000 and one of batch 2's at Rp 12.000, off the rack holding the fewest (Rak A holds 3, Rak B 4) — and each line
// carries the batch value the take drew (the-custom-shipments-prototype-is-accepted, a-sample-is-a-stock-out-at-batch-
// value, a-sample-keeps-its-recipient). The pick page finds the racks through StockPickLocations.
func TestCustomShipmentCreate_SampleTakesAtCreateOldestBatchFirst(t *testing.T) {
	f := csStocked(t)

	cs := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 3), csProduct(wtKaosPolos, 1)))

	if cs.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED ||
		cs.GetKind() != inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE ||
		cs.GetTeamId() != otMelati || cs.GetWarehouseId() != wtA || cs.GetCreatedByUserId() != wtSeller ||
		cs.GetRestockId() != 0 || cs.GetSupplierId() != 0 {
		t.Fatalf("custom shipment = %+v, want Melati's requested sample from A by %d", cs, wtSeller)
	}

	hitam := csItemOf(t, cs, wtKaosHitam)
	if hitam.GetProductCode() != "KH-001" || hitam.GetName() != "Kaos Hitam" || hitam.GetQuantity() != 3 || hitam.GetTotal() != 32000 {
		t.Fatalf("Kaos Hitam line = %+v, want KH-001 × 3 at 32000", hitam)
	}

	if polos := csItemOf(t, cs, wtKaosPolos); polos.GetTotal() != 5000 {
		t.Fatalf("Kaos Polos line = %+v, want 5000", polos)
	}

	if cs.GetTotal() != 37000 || cs.GetFinanceAccountId() != wtAccount || cs.GetShippingCost() != 15000 {
		t.Fatalf("money = total %v, account %d, cost %v; want 37000, 77, 15000", cs.GetTotal(), cs.GetFinanceAccountId(),
			cs.GetShippingCost())
	}

	if cs.GetRecipient().GetName() != "Budi" || cs.GetRecipient().GetPhone() != "0812-1111" ||
		cs.GetShipmentChannelId() != csCourier || cs.GetNote() != "sample for Budi" {
		t.Fatalf("parcel = %+v, want Budi by courier 9", cs)
	}

	var take models.InventoryTransaction
	f.db.First(&take, cs.GetTransactionId())

	if take.TxType != models.TxSample || take.TeamID != otMelati || take.WarehouseID != wtA || take.Recipient != "Budi" ||
		take.Description != "custom shipment #"+itoa(cs.GetId()) || take.CreateByUserID != wtSeller {
		t.Fatalf("take = %+v, want Melati's sample at A for Budi, naming custom shipment #%d", take, cs.GetId())
	}

	err := inventory_ledgers.Verify(f.db, take.ID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 4 || r != 4 {
		t.Fatalf("A holds %d / %d Kaos Hitam, want 4 in both ledgers", b, r)
	}

	// The pick page's racks: the take's own rack rows, all three Kaos Hitam off Rak A.
	picks, err := f.svc.StockPickLocations(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
		WarehouseId: wtA, TransactionId: cs.GetTransactionId(),
	}))
	if err != nil {
		t.Fatalf("pick locations: %v", err)
	}

	got := map[uint64]map[uint64]int64{}
	for _, loc := range picks.Msg.GetLocations() {
		if got[loc.GetProductId()] == nil {
			got[loc.GetProductId()] = map[uint64]int64{}
		}

		got[loc.GetProductId()][loc.GetRackId()] += loc.GetQuantity()
	}

	if len(got[wtKaosHitam]) != 1 || got[wtKaosHitam][f.rakA] != 3 || got[wtKaosPolos][f.rakB] != 1 {
		t.Fatalf("picks = %v, want Kaos Hitam 3 off Rak A and Kaos Polos 1 off Rak B", got)
	}

	if logs := cs.GetLogs(); len(logs) != 1 ||
		logs[0].GetFromStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_UNSPECIFIED ||
		logs[0].GetToStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED ||
		logs[0].GetActorUserId() != wtSeller {
		t.Fatalf("trail = %+v, want one row into requested by %d", logs, wtSeller)
	}

	events := f.customShipmentEvents()
	if len(events) != 1 {
		t.Fatalf("%d custom shipment events, want 1", len(events))
	}

	created := events[0].GetCustomShipmentCreated()
	if events[0].GetEventId() != "custom-shipment-created:"+itoa(cs.GetId()) || created.GetCustomShipmentId() != cs.GetId() ||
		created.GetTeamId() != otMelati || created.GetWarehouseId() != wtA ||
		created.GetKind() != inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE ||
		created.GetPayer() != inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM ||
		created.GetFinanceAccountId() != wtAccount || created.GetAmount() != 15000 || created.GetActorId() != wtSeller {
		t.Fatalf("event %s = %+v, want Melati's sample, account 77 paying 15000", events[0].GetEventId(), created)
	}
}

// Too few in the warehouse refuses the create, naming every short line, and writes nothing at all — no parcel, no take.
func TestCustomShipmentCreate_SampleTooFewFailsAndWritesNothing(t *testing.T) {
	f := csStocked(t)

	_, err := f.create(csSample("k-1", csProduct(wtKaosHitam, 8), csProduct(wtKaosPolos, 5)))
	wantCode(t, err, connect.CodeFailedPrecondition, "8 Kaos Hitam of 7, 5 Kaos Polos of 4")

	if msg := err.Error(); !strings.Contains(msg, itoa(wtKaosHitam)) || !strings.Contains(msg, itoa(wtKaosPolos)) {
		t.Fatalf("refusal %q does not name both short lines", msg)
	}

	var parcels, samples int64
	f.db.Model(&models.CustomShipment{}).Count(&parcels)
	f.db.Model(&models.InventoryTransaction{}).Where("tx_type = ?", models.TxSample).Count(&samples)

	if parcels != 0 || samples != 0 {
		t.Fatalf("%d parcels and %d sample takes written by a refused create", parcels, samples)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 7 || r != 7 {
		t.Fatalf("A holds %d / %d Kaos Hitam, want all 7 still", b, r)
	}

	if len(f.customShipmentEvents()) != 0 {
		t.Fatal("a refused create published an event")
	}
}

// A key already on one of the team's parcels is refused — never answered with that parcel, and never a second take
// (a double tap on the form).
func TestCustomShipmentCreate_AUsedKeyIsRefused(t *testing.T) {
	f := csStocked(t)

	f.mustCreate(t, csSample("tap", csProduct(wtKaosHitam, 1)))

	_, err := f.create(csSample("tap", csProduct(wtKaosHitam, 1)))
	wantCode(t, err, connect.CodeAlreadyExists, "the same key twice")

	var samples int64
	f.db.Model(&models.InventoryTransaction{}).Where("tx_type = ?", models.TxSample).Count(&samples)

	if b, _ := unitsAt(t, f.db, wtA, wtKaosHitam); b != 6 || samples != 1 {
		t.Fatalf("A holds %d Kaos Hitam after %d takes, want 6 after 1", b, samples)
	}
}

// The rules across fields: a sample names its warehouse and products only, a product once, only the team's own; the
// team pays from an account it names; a warehouse that pays names no account and no cost at create.
func TestCustomShipmentCreate_RefusesTheShapeRules(t *testing.T) {
	f := csStocked(t)

	cases := map[string]struct {
		req  *inventoryv1.CustomShipmentCreateRequest
		code connect.Code
	}{
		"a sample with no warehouse": {
			req: func() *inventoryv1.CustomShipmentCreateRequest {
				r := csSample("a", csProduct(wtKaosHitam, 1))
				r.WarehouseId = 0

				return r
			}(),
			code: connect.CodeInvalidArgument,
		},
		"a sample naming a restock": {
			req: func() *inventoryv1.CustomShipmentCreateRequest {
				r := csSample("b", csProduct(wtKaosHitam, 1))
				r.RestockId = f.restock

				return r
			}(),
			code: connect.CodeInvalidArgument,
		},
		"a sample line naming a restock line": {
			req:  csSample("c", &inventoryv1.CustomShipmentLine{ProductId: csWidget, RestockItemId: f.line[csWidget], Quantity: 1}),
			code: connect.CodeInvalidArgument,
		},
		"a product twice":               {req: csSample("d", csProduct(wtKaosHitam, 1), csProduct(wtKaosHitam, 1)), code: connect.CodeInvalidArgument},
		"another team's product":        {req: csSample("e", csProduct(wtKaosMerah, 1)), code: connect.CodeInvalidArgument},
		"a product that exists nowhere": {req: csSample("f", csProduct(otKaosKuning, 1)), code: connect.CodeInvalidArgument},
		"the team pays from no account": {
			req: func() *inventoryv1.CustomShipmentCreateRequest {
				r := csSample("g", csProduct(wtKaosHitam, 1))
				r.FinanceAccountId = 0

				return r
			}(),
			code: connect.CodeInvalidArgument,
		},
		"the warehouse pays, an account named": {
			req: func() *inventoryv1.CustomShipmentCreateRequest {
				r := csSample("h", csProduct(wtKaosHitam, 1))
				r.Payer = inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE
				r.ShippingCost = 0

				return r
			}(),
			code: connect.CodeInvalidArgument,
		},
		"the warehouse pays, a cost typed at create": {
			req: func() *inventoryv1.CustomShipmentCreateRequest {
				r := csSample("i", csProduct(wtKaosHitam, 1))
				r.Payer = inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE
				r.FinanceAccountId = 0

				return r
			}(),
			code: connect.CodeInvalidArgument,
		},
		"a reship with no restock": {
			req: func() *inventoryv1.CustomShipmentCreateRequest {
				r := f.csReship("j", csRestockLine(f.line[csWidget], 1))
				r.RestockId = 0

				return r
			}(),
			code: connect.CodeInvalidArgument,
		},
		"a reship line naming only a product": {req: f.csReship("k", csProduct(csWidget, 1)), code: connect.CodeInvalidArgument},
		"a restock line twice": {
			req:  f.csReship("l", csRestockLine(f.line[csWidget], 1), csRestockLine(f.line[csWidget], 1)),
			code: connect.CodeInvalidArgument,
		},
	}

	for name, c := range cases {
		_, err := f.create(c.req)
		wantCode(t, err, c.code, name)
	}

	var parcels int64
	f.db.Model(&models.CustomShipment{}).Count(&parcels)

	if parcels != 0 {
		t.Fatalf("%d parcels written by refused creates", parcels)
	}
}

// The courier's account is one of the team's ACTIVE accounts — any of them, operational or not, as a transfer's
// shipping; an archived or another team's account is refused before anything is written.
func TestCustomShipmentCreate_TheTeamPaysFromAnActiveAccount(t *testing.T) {
	f := csStocked(t)
	f.svc = newCustomShipmentServiceWithAccounts(f)

	r := csSample("plain", csProduct(wtKaosHitam, 1))
	r.FinanceAccountId = accountPlain
	f.mustCreate(t, r)

	for _, account := range []uint64{accountArchived, accountOtherTeams} {
		r := csSample("refused-"+itoa(account), csProduct(wtKaosHitam, 1))
		r.FinanceAccountId = account

		_, err := f.create(r)
		wantCode(t, err, connect.CodeFailedPrecondition, "account "+itoa(account))
	}

	var parcels int64
	f.db.Model(&models.CustomShipment{}).Count(&parcels)

	if parcels != 1 {
		t.Fatalf("%d parcels, want only the one paid from an active account", parcels)
	}
}

// ── the reship ──────────────────────────────────────────────────────────────────────────────────────────────────────

// Melati sends 2 of the restock's 3 broken Widgets back to supplier 31, the warehouse paying the courier. No stock moves
// — broken units never entered a batch or a rack — and the parcel ships from the restock's warehouse, to its line's
// supplier, the line's code, name and broken note copied.
func TestCustomShipmentCreate_ReshipSendsBrokenUnitsAndTakesNoStock(t *testing.T) {
	f := csStocked(t)

	var txBefore int64
	f.db.Model(&models.InventoryTransaction{}).Count(&txBefore)

	widgetBatches, widgetRacks := unitsAt(t, f.db, wtA, csWidget)

	cs := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 2)))

	if cs.GetKind() != inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP ||
		cs.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED ||
		cs.GetWarehouseId() != wtA || cs.GetRestockId() != f.restock || cs.GetSupplierId() != csSupplierA ||
		cs.GetTransactionId() != 0 || cs.GetTotal() != 0 || cs.GetFinanceAccountId() != 0 || cs.GetShippingCost() != 0 {
		t.Fatalf("reship = %+v, want a requested reship of restock %d from A to supplier 31, no take", cs, f.restock)
	}

	widget := csItemOf(t, cs, csWidget)
	if widget.GetRestockItemId() != f.line[csWidget] || widget.GetQuantity() != 2 || widget.GetProductCode() != "WG-1" ||
		widget.GetName() != "Widget" || widget.GetBrokenNote() != "crushed" || widget.GetTotal() != 0 {
		t.Fatalf("Widget line = %+v, want restock line %d × 2, WG-1, \"crushed\"", widget, f.line[csWidget])
	}

	var txAfter int64
	f.db.Model(&models.InventoryTransaction{}).Count(&txAfter)

	if b, r := unitsAt(t, f.db, wtA, csWidget); txAfter != txBefore || b != widgetBatches || r != widgetRacks {
		t.Fatalf("a reship wrote %d transactions and moved Widget %d/%d → %d/%d; want none", txAfter-txBefore,
			widgetBatches, widgetRacks, b, r)
	}

	events := f.customShipmentEvents()
	if len(events) != 1 {
		t.Fatalf("%d events, want 1", len(events))
	}

	created := events[0].GetCustomShipmentCreated()
	if created.GetPayer() != inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE ||
		created.GetKind() != inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP ||
		created.GetFinanceAccountId() != 0 || created.GetAmount() != 0 {
		t.Fatalf("event = %+v, want a warehouse-paid reship carrying no account and no amount", created)
	}
}

// AT MOST THE BROKEN COUNT LESS WHAT LIVE RESHIPS CARRY. The Widget line has 3 broken: a reship of 2 leaves 1, so a
// second of 2 is refused naming the line, a second of 1 is taken, and then nothing is left. A cancelled reship's units
// are free again (a-custom-shipment-is-cancelled-only-while-requested).
func TestCustomShipmentCreate_ReshipIsCappedByBrokenLessLiveReships(t *testing.T) {
	f := csStocked(t)

	first := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 2)))

	_, err := f.create(f.csReship("r-2", csRestockLine(f.line[csWidget], 2)))
	wantCode(t, err, connect.CodeFailedPrecondition, "2 more of a line with 1 left")

	if msg := err.Error(); !strings.Contains(msg, "line "+itoa(f.line[csWidget])) || !strings.Contains(msg, "3 broken, 2 already") {
		t.Fatalf("refusal %q does not name the line, its broken units and what is already sent", msg)
	}

	f.mustCreate(t, f.csReship("r-3", csRestockLine(f.line[csWidget], 1)))

	_, err = f.create(f.csReship("r-4", csRestockLine(f.line[csWidget], 1)))
	wantCode(t, err, connect.CodeFailedPrecondition, "a line with nothing left")

	// The first is called off (the cancel itself is P3 — its status is what frees the units).
	f.db.Model(&models.CustomShipment{}).
		Where("id = ?", first.GetId()).
		Update("status", models.CustomShipmentCancelled)

	f.mustCreate(t, f.csReship("r-5", csRestockLine(f.line[csWidget], 2)))

	var live int64
	f.db.Raw(`SELECT COALESCE(SUM(i.quantity), 0) FROM custom_shipment_items i
	          JOIN custom_shipments c ON c.id = i.custom_shipment_id
	          WHERE i.restock_item_id = ? AND c.status <> 'cancelled'`, f.line[csWidget]).Scan(&live)

	if live != 3 {
		t.Fatalf("live reships carry %d Widgets, want exactly the 3 broken", live)
	}
}

// A line with no broken units sends nothing — Gizmo arrived whole; and a refusal names EVERY line over, writing nothing.
func TestCustomShipmentCreate_ReshipRefusesALineWithNothingBroken(t *testing.T) {
	f := csStocked(t)

	_, err := f.create(f.csReship("r-1", csRestockLine(f.line[csWidget], 4), csRestockLine(f.line[csGizmo], 1)))
	wantCode(t, err, connect.CodeFailedPrecondition, "4 of 3 broken Widgets and 1 of 0 broken Gizmos")

	if msg := err.Error(); !strings.Contains(msg, "line "+itoa(f.line[csWidget])) || !strings.Contains(msg, "line "+itoa(f.line[csGizmo])) {
		t.Fatalf("refusal %q does not name both lines", msg)
	}

	var parcels int64
	f.db.Model(&models.CustomShipment{}).Count(&parcels)

	if parcels != 0 {
		t.Fatalf("%d parcels written by a refused reship", parcels)
	}
}

// ONE PARCEL GOES TO ONE SUPPLIER: Widget (supplier 31) and Gadget (supplier 32) cannot share a parcel; Widget and Gizmo
// (both 31) can.
func TestCustomShipmentCreate_ReshipGoesToOneSupplier(t *testing.T) {
	f := csStocked(t)

	_, err := f.create(f.csReship("r-1", csRestockLine(f.line[csWidget], 1), csRestockLine(f.line[csGadget], 1)))
	wantCode(t, err, connect.CodeInvalidArgument, "lines of two suppliers")

	cs := f.mustCreate(t, f.csReship("r-2", csRestockLine(f.line[csGadget], 2)))
	if cs.GetSupplierId() != csSupplierB {
		t.Fatalf("supplier = %d, want the Gadget line's 32", cs.GetSupplierId())
	}
}

// Only the team's own RECEIVED restock, its own lines, from its own warehouse: a restock still on its way is refused,
// another team's reads as one that never existed, a line of another restock or another product is refused, and a
// warehouse other than the restock's is refused.
func TestCustomShipmentCreate_ReshipOnlyFromTheTeamsReceivedRestock(t *testing.T) {
	f := csStocked(t)

	notReceived := f.csReship("r-1", csRestockLine(f.line[csWidget], 1))
	notReceived.RestockId = f.ongoing

	_, err := f.create(notReceived)
	wantCode(t, err, connect.CodeFailedPrecondition, "a restock still on its way")

	sinars := f.csReship("r-2", csRestockLine(f.sinarLine, 1))
	sinars.RestockId = f.sinarRestock

	_, err = f.create(sinars)
	wantCode(t, err, connect.CodeNotFound, "Sinar's restock")

	_, err = f.create(f.csReship("r-3", csRestockLine(f.sinarLine, 1)))
	wantCode(t, err, connect.CodeInvalidArgument, "another restock's line")

	wrongProduct := f.csReship("r-4", &inventoryv1.CustomShipmentLine{RestockItemId: f.line[csWidget], ProductId: csGadget, Quantity: 1})

	_, err = f.create(wrongProduct)
	wantCode(t, err, connect.CodeInvalidArgument, "a line naming another product")

	elsewhere := f.csReship("r-5", csRestockLine(f.line[csWidget], 1))
	elsewhere.WarehouseId = wtB

	_, err = f.create(elsewhere)
	wantCode(t, err, connect.CodeInvalidArgument, "another warehouse")

	same := f.csReship("r-6", csRestockLine(f.line[csWidget], 1))
	same.WarehouseId = wtA
	f.mustCreate(t, same)
}
