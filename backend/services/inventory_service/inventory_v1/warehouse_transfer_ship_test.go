package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// A hands the box over with the courier, the tracking number and the label photo (the-sender-enters-the-courier-at-ship)
// — and only once it has been processed.
func TestWarehouseTransferShip_SavesTheTripFromProcess(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 1))

	ship := func() (*inventoryv1.WarehouseTransfer, error) {
		res, err := f.svc.WarehouseTransferShip(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferShipRequest{
			TeamId: wtA, TransferId: tr.GetId(), ShipmentId: 4, Receipt: "JP1830099", ReceiptFile: "labels/601.jpg",
		}))
		if err != nil {
			return nil, err
		}

		return res.Msg.GetTransfer(), nil
	}

	_, err := ship()
	wantCode(t, err, connect.CodeFailedPrecondition, "shipped while created")

	f.process(t, tr.GetId())

	got, err := ship()
	if err != nil {
		t.Fatalf("ship: %v", err)
	}

	if got.GetStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_SHIPPED || got.GetShipmentId() != 4 ||
		got.GetReceipt() != "JP1830099" || got.GetReceiptFile() != "labels/601.jpg" || got.GetShippedByUserId() != wtStaffA {
		t.Fatalf("transfer = %+v, want shipped by %d with courier 4 and JP1830099", got, wtStaffA)
	}
}
