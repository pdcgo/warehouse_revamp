package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// Melati sends Kaos Hitam × 3 and Kaos Polos × 1 to B, paying Rp 18.000 from account 77. The out-leg takes at create —
// batch 1's two units at Rp 10.000 and one of batch 2's at Rp 12.000, the rack holding the fewest first — and every
// price is filled from what it took (a-transfer-takes-from-the-sender-at-create, the-system-fills-a-transfers-prices).
func TestWarehouseTransferCreate_TakesFromAAtCreate(t *testing.T) {
	f := wtStocked(t)

	res, err := f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Note: "rebalance",
		Lines:        []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 3), wtLine(wtKaosPolos, 1)},
		ShipmentCost: 18000, FinanceAccountId: wtAccount,
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	tr := res.Msg.GetTransfer()

	if tr.GetStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_CREATED || tr.GetCreatedByUserId() != wtSeller {
		t.Fatalf("transfer = %v by %d, want created by %d", tr.GetStatus(), tr.GetCreatedByUserId(), wtSeller)
	}

	hitam := itemOf(t, tr, wtKaosHitam)
	if hitam.GetProductCode() != "KH-001" || hitam.GetName() != "Kaos Hitam" || hitam.GetTotal() != 32000 || !san_money.Equal(hitam.GetPriceUnit(), 32000.0/3) {
		t.Fatalf("Kaos Hitam line = %+v, want KH-001 at 32000, 10666.67 a unit", hitam)
	}

	// Rak A holds 3 of them and Rak B 4: the fewest first, so all three come off Rak A.
	if picks := hitam.GetPicks(); len(picks) != 1 || picks[0].GetPlacementId() != f.rakA || picks[0].GetQuantity() != 3 {
		t.Fatalf("Kaos Hitam picks = %+v, want 3 off Rak A", picks)
	}

	if tr.GetTotal() != 37000 {
		t.Fatalf("total = %v, want 32000 + 5000", tr.GetTotal())
	}

	var leg models.InventoryTransaction
	f.db.First(&leg, tr.GetOutboundTransactionId())

	if leg.TxType != models.TxTransferOut || leg.TeamID != otMelati || leg.WarehouseID != wtA {
		t.Fatalf("out-leg = %+v, want Melati's transfer_out at A", leg)
	}

	err = inventory_ledgers.Verify(f.db, leg.ID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 4 || r != 4 {
		t.Fatalf("A holds %d / %d Kaos Hitam, want 4 in both ledgers", b, r)
	}

	// B's crew can find what is coming (a-transfer-links-its-products-to-the-receiver).
	var links int64
	f.db.Model(&models.WarehouseProduct{}).Where("warehouse_id = ? AND product_id IN ?", wtB, []uint64{wtKaosHitam, wtKaosPolos}).Count(&links)
	if links != 2 {
		t.Fatalf("%d products linked to B, want 2", links)
	}

	if logs := tr.GetLogs(); len(logs) != 1 || logs[0].GetToStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_CREATED {
		t.Fatalf("trail = %+v, want one row into created", logs)
	}

	events := f.transferEvents()
	if len(events) != 1 {
		t.Fatalf("%d transfer events, want 1", len(events))
	}

	created := events[0].GetWarehouseTransferCreated()
	if created.GetTransferId() != tr.GetId() || created.GetFinanceAccountId() != wtAccount || created.GetAmount() != 18000 ||
		events[0].GetEventId() != "warehouse-transfer-created:"+itoa(tr.GetId()) {
		t.Fatalf("event %s = %+v, want transfer %d, account 77, 18000", events[0].GetEventId(), created, tr.GetId())
	}
}

// Too few at A refuses the create, naming every short line, and writes nothing at all.
func TestWarehouseTransferCreate_TooFewAtAFailsAndWritesNothing(t *testing.T) {
	f := wtStocked(t)

	_, err := f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB,
		Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 8), wtLine(wtKaosPolos, 5)},
	}))
	wantCode(t, err, connect.CodeFailedPrecondition, "8 Kaos Hitam of 7, 5 Kaos Polos of 4")

	if msg := err.Error(); !strings.Contains(msg, itoa(wtKaosHitam)) || !strings.Contains(msg, itoa(wtKaosPolos)) {
		t.Fatalf("refusal %q does not name both short lines", msg)
	}

	var transfers, legs int64
	f.db.Model(&models.WarehouseTransfer{}).Count(&transfers)
	f.db.Model(&models.InventoryTransaction{}).Where("tx_type = ?", models.TxTransferOut).Count(&legs)

	if transfers != 0 || legs != 0 {
		t.Fatalf("%d transfers and %d out-legs written by a refused create", transfers, legs)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 7 || r != 7 {
		t.Fatalf("A holds %d / %d Kaos Hitam, want all 7 still", b, r)
	}
}

// The rules across fields: A is never B, a product once, an account with a cost, and only the team's own products.
func TestWarehouseTransferCreate_RefusesTheShapeRules(t *testing.T) {
	f := wtStocked(t)

	cases := map[string]*inventoryv1.WarehouseTransferCreateRequest{
		"to its own warehouse": {
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtA, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 1)},
		},
		"a product twice": {
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB,
			Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 1), wtLine(wtKaosHitam, 1)},
		},
		"a cost with no account": {
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, ShipmentCost: 5000,
			Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 1)},
		},
		"another team's product": {
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosMerah, 1)},
		},
		"a product that exists nowhere": {
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(otKaosKuning, 1)},
		},
	}

	for name, req := range cases {
		_, err := f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(req))
		wantCode(t, err, connect.CodeInvalidArgument, name)
	}
}

// The account paying the shipping must be one of Melati's ACTIVE accounts (a-transfer-names-its-paying-account,
// a-transfers-shipping-is-paid-from-any-active-account): an archived one, and another team's, which reads as one that
// never existed, are FailedPrecondition naming it —
// and nothing is written: no transfer, no out-leg, nothing published. A transfer with no cost names no account and
// asks nothing.
func TestWarehouseTransferCreate_RefusesAnAccountThatIsNotActive(t *testing.T) {
	f := wtStocked(t)
	svc := inventory_v1.NewService(f.db, nil, nil, nil, f.sent.send, wtFacts(), nil, restockAccounts())

	create := func(cost float64, account uint64) error {
		_, err := svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB,
			Lines:        []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosPolos, 1)},
			ShipmentCost: cost, FinanceAccountId: account,
		}))

		return err
	}

	cases := []struct {
		account uint64
		names   string
	}{
		{accountArchived, "Mandiri Lama"},
		{accountOtherTeams, "account #44"},
	}

	for _, c := range cases {
		err := create(18000, c.account)
		wantCode(t, err, connect.CodeFailedPrecondition, "shipping paid from account "+itoa(c.account))

		if !strings.Contains(err.Error(), c.names) || !strings.Contains(err.Error(), "active accounts") {
			t.Fatalf("account %d: the refusal must name it: %v", c.account, err)
		}
	}

	var stored int64

	err := f.db.Model(&models.WarehouseTransfer{}).Where("team_id = ?", otMelati).Count(&stored).Error
	if err != nil {
		t.Fatal(err)
	}

	if stored != 0 || len(f.sent.events) != 0 {
		t.Fatalf("a refused transfer wrote %d rows and published %d events", stored, len(f.sent.events))
	}

	if batches, racks := unitsAt(t, f.db, wtA, wtKaosPolos); batches != 4 || racks != 4 {
		t.Fatalf("a refused transfer took from A: %d in batches, %d on racks, want 4 and 4", batches, racks)
	}

	err = create(18000, accountOperational)
	if err != nil {
		t.Fatalf("an active operational account must be accepted: %v", err)
	}

	// Not marked operational, but active and Melati's own: a transfer may be paid from it.
	err = create(18000, accountPlain)
	if err != nil {
		t.Fatalf("an active account not marked operational must be accepted: %v", err)
	}

	// No cost: the account is dropped before anything is asked, so even a stale id passes.
	err = create(0, accountArchived)
	if err != nil {
		t.Fatalf("a transfer with no cost names no account: %v", err)
	}
}
