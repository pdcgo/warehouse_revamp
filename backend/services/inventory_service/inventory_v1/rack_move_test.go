package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A MOVE ON THE DECIDED LEDGERS: rack rows only, one transaction per owning team, all or nothing.

func rackCount(t *testing.T, db *gorm.DB, product, rack uint64) int64 {
	t.Helper()

	var n int64
	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE product_id = ? AND placement_id = ?`,
		product, rack).Scan(&n)

	return n
}

func move(svc *inventory_v1.Service, from uint64, lines ...*inventoryv1.RackMoveLine) (*inventoryv1.RackMoveResponse, error) {
	res, err := svc.RackMove(ctxUser(8), connect.NewRequest(&inventoryv1.RackMoveRequest{
		TeamId: otWarehouse, FromRackId: from, Lines: lines, Description: "tidy Rak A",
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func moveLine(product uint64, qty int64, to uint64) *inventoryv1.RackMoveLine {
	return &inventoryv1.RackMoveLine{ProductId: product, Quantity: qty, ToRackId: to}
}

// 4 Kaos Hitam carried from Rak A to Rak B, where Melati had none: Rak B's row is created, both racks get a `move` row,
// the batch ledger is untouched, and the item counts 4 at zero value.
func TestRackMove_MovesTheUnitsAndWritesNoBatchRow(t *testing.T) {
	svc, db, rakA, rakB := otStocked(t)

	res, err := move(svc, rakA, moveLine(otKaosHitam, 4, rakB))
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	if len(res.GetTransactions()) != 1 || res.GetTransactions()[0].GetTeamId() != otMelati {
		t.Fatalf("transactions = %+v, want one, Melati's", res.GetTransactions())
	}

	txID := res.GetTransactions()[0].GetTransactionId()

	if a, b := rackCount(t, db, otKaosHitam, rakA), rackCount(t, db, otKaosHitam, rakB); a != 6 || b != 4 {
		t.Fatalf("Rak A %d, Rak B %d — want 6 and 4", a, b)
	}

	var batchRows int64
	db.Model(&models.BatchLog{}).Where("transaction_id = ?", txID).Count(&batchRows)
	if batchRows != 0 {
		t.Fatalf("a move wrote %d batch rows, want 0", batchRows)
	}

	err = inventory_ledgers.Verify(db, txID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

// Melati's Kaos Hitam split to two racks and Sinar's Kaos Merah beside it: TWO transactions, in team order, each with its
// own rows — one database transaction for all of it.
func TestRackMove_SplitsAndWritesOneTransactionPerOwner(t *testing.T) {
	svc, db, rakA, rakB := otStocked(t)
	rakC := newRack(t, svc, otWarehouse, "rak-c")

	res, err := move(svc, rakA, moveLine(otKaosHitam, 3, rakB), moveLine(otKaosHitam, 2, rakC), moveLine(otKaosMerah, 1, rakB))
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	txs := res.GetTransactions()
	if len(txs) != 2 || txs[0].GetTeamId() != otMelati || txs[1].GetTeamId() != otSinar {
		t.Fatalf("transactions = %+v, want Melati's then Sinar's", txs)
	}

	for _, tx := range txs {
		err = inventory_ledgers.Verify(db, tx.GetTransactionId())
		if err != nil {
			t.Fatalf("Verify %d: %v", tx.GetTransactionId(), err)
		}
	}

	if a, b, c := rackCount(t, db, otKaosHitam, rakA), rackCount(t, db, otKaosHitam, rakB), rackCount(t, db, otKaosHitam, rakC); a != 5 || b != 3 || c != 2 {
		t.Fatalf("Kaos Hitam: Rak A %d, Rak B %d, Rak C %d — want 5, 3, 2", a, b, c)
	}
}

// More than the rack holds refuses the WHOLE move — the lines that would fit are not moved either
// (a-move-is-all-or-nothing).
func TestRackMove_RefusesMoreThanTheRackHoldsAndMovesNothing(t *testing.T) {
	svc, db, rakA, rakB := otStocked(t)

	_, err := move(svc, rakA, moveLine(otKaosHitam, 1, rakB), moveLine(otKaosPolos, 3, rakB))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition — Rak A holds 2 Kaos Polos", err)
	}

	if a := rackCount(t, db, otKaosHitam, rakA); a != 10 {
		t.Fatalf("Rak A holds %d Kaos Hitam, want 10 — the fitting line moved anyway", a)
	}

	var moves int64
	db.Model(&models.InventoryTransaction{}).Where("tx_type = ?", models.TxMove).Count(&moves)
	if moves != 0 {
		t.Fatalf("%d move transactions written by a refused move", moves)
	}
}

// A move never ends on the rack it leaves, and never reaches another warehouse's rack.
func TestRackMove_RefusesTheSameRackAndAnotherWarehouses(t *testing.T) {
	svc, _, rakA, _ := otStocked(t)
	elsewhere := newRack(t, svc, 950, "rak-x")

	_, err := move(svc, rakA, moveLine(otKaosHitam, 1, rakA))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("to the same rack: err = %v, want InvalidArgument", err)
	}

	_, err = move(svc, rakA, moveLine(otKaosHitam, 1, elsewhere))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("to another warehouse's rack: err = %v, want NotFound", err)
	}
}
