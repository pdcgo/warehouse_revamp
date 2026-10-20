package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// B'S COUNT AT THE DOOR: the in-leg mints one batch per source batch (the-receiver-mints-one-batch-per-source-batch);
// broken and missing come off the newest layer first and are priced from it (the-system-fills-a-transfers-prices).

func batchesAtB(t *testing.T, f *wtFixture, product uint64) []models.Batch {
	t.Helper()

	var rows []models.Batch
	f.db.Where("warehouse_id = ? AND product_id = ?", wtB, product).Order("id").Find(&rows)

	return rows
}

// Kaos Hitam × 5 left A as 2 at Rp 10.000 and 3 at Rp 12.000. B finds 5 in the box, 1 broken: the good 4 fill the
// oldest layer first — 2 at Rp 10.000, 2 at Rp 12.000 — and the broken unit comes off the newest, at Rp 12.000.
func TestWarehouseTransferAccept_MintsOneBatchPerSourceBatch(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 5))
	f.ship(t, tr.GetId())

	accepted, err := f.accept(tr.GetId(), 5000, "the courier asked at the door",
		counted(itemOf(t, tr, wtKaosHitam), 5, 1, f.rakB1))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if accepted.GetStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_ACCEPTED ||
		accepted.GetAcceptedByUserId() != wtStaffB || accepted.GetWarehouseAdditionalCost() != 5000 {
		t.Fatalf("transfer = %v by %d, charge %v — want accepted by %d with 5000",
			accepted.GetStatus(), accepted.GetAcceptedByUserId(), accepted.GetWarehouseAdditionalCost(), wtStaffB)
	}

	minted := batchesAtB(t, f, wtKaosHitam)
	if len(minted) != 2 ||
		minted[0].StockCount != 2 || !san_money.Equal(minted[0].PriceUnit, 10000) ||
		minted[1].StockCount != 2 || !san_money.Equal(minted[1].PriceUnit, 12000) {
		t.Fatalf("B's batches = %+v, want 2 at 10000 then 2 at 12000", minted)
	}

	for _, b := range minted {
		if b.TeamID != otMelati || b.TransactionID != accepted.GetInboundTransactionId() {
			t.Fatalf("batch %d is team %d from transaction %d, want Melati's from the in-leg", b.ID, b.TeamID, b.TransactionID)
		}
	}

	item := itemOf(t, accepted, wtKaosHitam)
	if item.GetArrivedCount() != 5 || len(item.GetPlacements()) != 1 || item.GetPlacements()[0].GetQuantity() != 4 {
		t.Fatalf("line = %+v, want 5 arrived and 4 on Rak B1", item)
	}

	if p := item.GetProblems(); len(p) != 1 || p[0].GetType() != inventoryv1.WarehouseTransferProblemType_WAREHOUSE_TRANSFER_PROBLEM_TYPE_BROKEN ||
		p[0].GetCount() != 1 || p[0].GetTotal() != 12000 {
		t.Fatalf("problems = %+v, want one broken at the newest layer's 12000", p)
	}

	var leg models.InventoryTransaction
	f.db.First(&leg, accepted.GetInboundTransactionId())

	if leg.TxType != models.TxTransferIn || leg.WarehouseID != wtB || leg.TeamID != otMelati {
		t.Fatalf("in-leg = %+v, want Melati's transfer_in at B", leg)
	}

	err = inventory_ledgers.Verify(f.db, leg.ID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if b, r := unitsAt(t, f.db, wtB, wtKaosHitam); b != 4 || r != 4 {
		t.Fatalf("B holds %d / %d Kaos Hitam, want 4 in both ledgers", b, r)
	}

	events := f.transferEvents()
	last := events[len(events)-1].GetWarehouseTransferAccepted()
	if last == nil || last.GetWarehouseAdditionalCost() != 5000 || last.GetToWarehouseId() != wtB || last.GetActorId() != wtStaffB ||
		last.GetWarehouseAdditionalCostNote() != "the courier asked at the door" {
		t.Fatalf("last event = %+v, want Warehouse Transfer Accepted with the 5000 charge", events[len(events)-1])
	}
}

// Short in the box: 3 of 5 arrived. The 2 missing come off the newest layer, at Rp 12.000 each; the 3 good fill batch 1
// and one of batch 2.
func TestWarehouseTransferAccept_MissingComesOffTheNewestLayer(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 5))
	f.ship(t, tr.GetId())

	accepted, err := f.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, wtKaosHitam), 3, 0, f.rakB1))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	minted := batchesAtB(t, f, wtKaosHitam)
	if len(minted) != 2 || minted[0].StockCount != 2 || minted[1].StockCount != 1 {
		t.Fatalf("B's batches = %+v, want 2 then 1", minted)
	}

	p := itemOf(t, accepted, wtKaosHitam).GetProblems()
	if len(p) != 1 || p[0].GetType() != inventoryv1.WarehouseTransferProblemType_WAREHOUSE_TRANSFER_PROBLEM_TYPE_MISSING ||
		p[0].GetCount() != 2 || p[0].GetTotal() != 24000 || p[0].GetPriceUnit() != 12000 {
		t.Fatalf("problems = %+v, want two missing at 12000", p)
	}
}

// Nothing arrived good: the in-leg is still written — the count happened (a-transaction-is-made-when-the-act-happens) —
// with no batch and no rack row.
func TestWarehouseTransferAccept_NothingGoodStillWritesTheInLeg(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosPolos, 2))
	f.ship(t, tr.GetId())

	accepted, err := f.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, wtKaosPolos), 2, 2, 0))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if accepted.GetInboundTransactionId() == 0 {
		t.Fatalf("no in-leg for an accept with nothing good")
	}

	if minted := batchesAtB(t, f, wtKaosPolos); len(minted) != 0 {
		t.Fatalf("%d batches minted at B for a box of broken units", len(minted))
	}

	err = inventory_ledgers.Verify(f.db, accepted.GetInboundTransactionId())
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

// What B may not do: count from the wrong status, from another warehouse, half the lines, more than was sent, more broken
// than arrived, put away a different number, onto another warehouse's rack, or charge without a note — and a box is
// accepted once.
func TestWarehouseTransferAccept_RefusesABadCount(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 2), wtLine(wtKaosPolos, 1))
	hitam, polos := itemOf(t, tr, wtKaosHitam), itemOf(t, tr, wtKaosPolos)
	foreign := newRack(t, f.svc, wtOther, "rak-x")

	_, err := f.accept(tr.GetId(), 0, "", counted(hitam, 2, 0, f.rakB1), counted(polos, 1, 0, f.rakB1))
	wantCode(t, err, connect.CodeFailedPrecondition, "accept while created")

	f.ship(t, tr.GetId())

	_, err = f.svc.WarehouseTransferAccept(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
		TeamId: wtA, TransferId: tr.GetId(), Lines: []*inventoryv1.WarehouseTransferCountedLine{counted(hitam, 2, 0, f.rakB1), counted(polos, 1, 0, f.rakB1)},
	}))
	wantCode(t, err, connect.CodeNotFound, "accepted by A")

	bad := map[string][]*inventoryv1.WarehouseTransferCountedLine{
		"half the lines":           {counted(hitam, 2, 0, f.rakB1)},
		"a line twice":             {counted(hitam, 2, 0, f.rakB1), counted(hitam, 2, 0, f.rakB1)},
		"more than was sent":       {counted(hitam, 3, 0, f.rakB1), counted(polos, 1, 0, f.rakB1)},
		"more broken than arrived": {{ItemId: hitam.GetId(), ArrivedCount: 1, BrokenCount: 2}, counted(polos, 1, 0, f.rakB1)},
		"put away short": {
			{ItemId: hitam.GetId(), ArrivedCount: 2, Placements: []*inventoryv1.WarehouseTransferPlacement{{PlacementId: f.rakB1, Quantity: 1}}},
			counted(polos, 1, 0, f.rakB1),
		},
	}

	for name, lines := range bad {
		_, err = f.accept(tr.GetId(), 0, "", lines...)
		wantCode(t, err, connect.CodeInvalidArgument, name)
	}

	_, err = f.accept(tr.GetId(), 0, "", counted(hitam, 2, 0, foreign), counted(polos, 1, 0, f.rakB1))
	wantCode(t, err, connect.CodeNotFound, "onto another warehouse's rack")

	_, err = f.accept(tr.GetId(), 3000, "", counted(hitam, 2, 0, f.rakB1), counted(polos, 1, 0, f.rakB1))
	wantCode(t, err, connect.CodeInvalidArgument, "a charge with no note")

	if minted := batchesAtB(t, f, wtKaosHitam); len(minted) != 0 {
		t.Fatalf("%d batches minted at B by refused accepts", len(minted))
	}

	_, err = f.accept(tr.GetId(), 0, "", counted(hitam, 2, 0, f.rakB1), counted(polos, 1, 0, f.rakB2))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	_, err = f.accept(tr.GetId(), 0, "", counted(hitam, 2, 0, f.rakB1), counted(polos, 1, 0, f.rakB2))
	wantCode(t, err, connect.CodeFailedPrecondition, "accepted twice")

	if b, _ := unitsAt(t, f.db, wtB, wtKaosHitam); b != 2 {
		t.Fatalf("B holds %d Kaos Hitam after two accepts, want 2", b)
	}
}
