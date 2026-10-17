package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A SAMPLE ON THE DECIDED LEDGERS: a stock-out at batch value off the page's rack, carrying who received it.

// 1 Kaos Polos handed to Budi from Rak B: Sinar's `sample` transaction names Budi, Rak B gives the unit, the oldest batch
// gives its value, and both invariants hold.
func TestRackSample_TakesFromTheRackAndTheOldestBatch(t *testing.T) {
	svc, db, _, rakB := otStocked(t)

	res, err := svc.RackSample(ctxUser(8), connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: otWarehouse, RackId: rakB, Recipient: "Budi", Description: "for a review video",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: otKaosPolos, Quantity: 1}},
	}))
	if err != nil {
		t.Fatalf("sample: %v", err)
	}

	txs := res.Msg.GetTransactions()
	if len(txs) != 1 || txs[0].GetTeamId() != otSinar {
		t.Fatalf("transactions = %+v, want one, Sinar's", txs)
	}

	var tx models.InventoryTransaction
	db.First(&tx, txs[0].GetTransactionId())

	if tx.TxType != models.TxSample || tx.Recipient != "Budi" || tx.Description != "for a review video" {
		t.Fatalf("transaction = %+v, want a sample to Budi with its note", tx)
	}

	if b := rackCount(t, db, otKaosPolos, rakB); b != 2 {
		t.Fatalf("Rak B holds %d Kaos Polos, want 2", b)
	}

	var item models.InventoryTransactionItem
	db.Where("transaction_id = ?", tx.ID).First(&item)
	if item.Quantity != 1 || !san_money.Equal(item.Total, 20000) {
		t.Fatalf("item = %+v, want 1 at the batch's 20000", item)
	}

	err = inventory_ledgers.Verify(db, tx.ID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

// A product the rack does not hold is refused; nothing is written.
func TestRackSample_RefusesAProductNotOnTheRack(t *testing.T) {
	svc, db, _, rakB := otStocked(t)

	_, err := svc.RackSample(ctxUser(8), connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: otWarehouse, RackId: rakB, Recipient: "Budi",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: otKaosHitam, Quantity: 1}},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition — Kaos Hitam is not on Rak B", err)
	}

	var samples int64
	db.Model(&models.InventoryTransaction{}).Where("tx_type = ?", models.TxSample).Count(&samples)
	if samples != 0 {
		t.Fatalf("%d sample transactions written by a refused sample", samples)
	}
}
