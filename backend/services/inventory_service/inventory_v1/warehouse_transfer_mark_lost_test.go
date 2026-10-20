package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

func markTransferLost(f *wtFixture, team, id uint64) (*inventoryv1.WarehouseTransfer, error) {
	res, err := f.svc.WarehouseTransferMarkLost(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferMarkLostRequest{
		TeamId: team, TransferId: id, Description: "courier lost it",
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTransfer(), nil
}

// Lost only in transit, by the owning team; no ledger moves — the units left A at create and are in the transfer
// (the-transfer-is-where-goods-in-transit-are). A lost box that turns up is signed for, then counted as usual.
func TestWarehouseTransferMarkLost_OnlyWhileShippedAndTheBoxMayTurnUp(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 2))

	_, err := markTransferLost(f, otMelati, tr.GetId())
	wantCode(t, err, connect.CodeFailedPrecondition, "lost while created")

	f.ship(t, tr.GetId())

	_, err = markTransferLost(f, wtB, tr.GetId())
	wantCode(t, err, connect.CodeNotFound, "set lost by B")

	var before int64
	f.db.Model(&models.InventoryTransaction{}).Count(&before)

	lost, err := markTransferLost(f, otMelati, tr.GetId())
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	if lost.GetStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_LOST || lost.GetLostByUserId() != wtSeller {
		t.Fatalf("transfer = %v by %d, want lost by %d", lost.GetStatus(), lost.GetLostByUserId(), wtSeller)
	}

	var after int64
	f.db.Model(&models.InventoryTransaction{}).Count(&after)
	if after != before {
		t.Fatalf("setting a box lost wrote %d ledger transactions", after-before)
	}

	_, err = f.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, wtKaosHitam), 2, 0, f.rakB1))
	wantCode(t, err, connect.CodeFailedPrecondition, "accepted while lost")

	_, err = f.svc.WarehouseTransferArrive(ctxUser(wtStaffB), connect.NewRequest(&inventoryv1.WarehouseTransferArriveRequest{
		TeamId: wtB, TransferId: tr.GetId(),
	}))
	if err != nil {
		t.Fatalf("arrive from lost: %v", err)
	}

	_, err = f.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, wtKaosHitam), 2, 0, f.rakB1))
	if err != nil {
		t.Fatalf("accept after it turned up: %v", err)
	}
}
