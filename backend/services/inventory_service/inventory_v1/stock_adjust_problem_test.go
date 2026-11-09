package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE REGISTER'S SECOND DOOR (an-adjustment-writes-the-same-problem-row): a damaged or lost unit reported on the Adjust
// screen writes a `problem` transaction — its rows saying broken or lost — and the same warehouse_stock_problems row a
// count's finalize writes, at the batch's price, on the reported rack. Lost is claimable, broken never. No session lists
// the transaction.
func TestStockAdjust_ADamagedOrLostReportWritesTheRegister(t *testing.T) {
	f := opnameStocked(t)
	b2 := batchesOf(t, f, otKaosHitam)[1]

	report := func(reason inventoryv1.StockAdjustReason) *inventoryv1.StockAdjustResponse {
		res, err := f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
			WarehouseId: otWarehouse, ProductId: otKaosHitam, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakB},
			ReasonType: reason, BatchId: b2.ID, Quantity: 1, Reason: "dropped at 10:00",
		}))
		if err != nil {
			t.Fatalf("report %v: %v", reason, err)
		}

		return res.Msg
	}

	broken := report(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED)
	lost := report(inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST)

	for _, res := range []*inventoryv1.StockAdjustResponse{broken, lost} {
		txID := res.GetMovement().GetId()

		var tx models.InventoryTransaction
		f.db.First(&tx, txID)

		if tx.TxType != models.TxProblem || tx.TeamID != otMelati {
			t.Fatalf("transaction %+v, want Melati's problem", tx)
		}

		err := inventory_ledgers.Verify(f.db, txID)
		if err != nil {
			t.Fatalf("Verify: %v", err)
		}
	}

	var rows []models.WarehouseStockProblem
	f.db.Where("product_id = ?", otKaosHitam).Order("id").Find(&rows)

	if len(rows) != 2 {
		t.Fatalf("%d register rows, want 2", len(rows))
	}

	for i, kind := range []models.ProblemType{models.ProblemBroken, models.ProblemLost} {
		r := rows[i]
		claimable := int64(0)
		if kind == models.ProblemLost {
			claimable = 1
		}

		if r.ProblemType != kind || r.BatchID != b2.ID || r.PlacementID == nil || *r.PlacementID != f.rakB ||
			r.ClaimableStockCount != claimable || !san_money.Equal(r.PriceUnit, 12000) || r.Note != "dropped at 10:00" {
			t.Fatalf("row %d %+v, want %s of batch 2 on Rak B at Rp 12.000, claimable %d", i, r, kind, claimable)
		}
	}

	var rackKinds []string
	f.db.Model(&models.ProductPlacementLog{}).Where("transaction_id IN ?", []uint64{broken.GetMovement().GetId(), lost.GetMovement().GetId()}).
		Order("id").Pluck("change_type", &rackKinds)

	if len(rackKinds) != 2 || rackKinds[0] != "broken" || rackKinds[1] != "lost" {
		t.Fatalf("rack rows %v, want broken then lost", rackKinds)
	}

	var listed int64
	f.db.Model(&models.OpnameSessionFinalTransaction{}).Count(&listed)
	if listed != 0 {
		t.Fatalf("a shelf report is listed by a session")
	}
}
