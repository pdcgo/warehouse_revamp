package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// B signs for the box once it is on its way; A cannot sign for it, and nothing is counted yet.
func TestWarehouseTransferArrive_OnlyTheReceiverOnceShipped(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 1))

	arrive := func(team uint64) (*inventoryv1.WarehouseTransfer, error) {
		res, err := f.svc.WarehouseTransferArrive(ctxUser(wtStaffB), connect.NewRequest(&inventoryv1.WarehouseTransferArriveRequest{
			TeamId: team, TransferId: tr.GetId(),
		}))
		if err != nil {
			return nil, err
		}

		return res.Msg.GetTransfer(), nil
	}

	f.process(t, tr.GetId())

	_, err := arrive(wtB)
	wantCode(t, err, connect.CodeFailedPrecondition, "signed for while process")

	_, err = f.svc.WarehouseTransferShip(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferShipRequest{
		TeamId: wtA, TransferId: tr.GetId(),
	}))
	if err != nil {
		t.Fatalf("ship: %v", err)
	}

	_, err = arrive(wtA)
	wantCode(t, err, connect.CodeNotFound, "signed for by A")

	got, err := arrive(wtB)
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	if got.GetStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_ARRIVED ||
		got.GetArrivedByUserId() != wtStaffB || got.GetInboundTransactionId() != 0 {
		t.Fatalf("transfer = %v by %d, in-leg %d — want arrived by %d and nothing counted",
			got.GetStatus(), got.GetArrivedByUserId(), got.GetInboundTransactionId(), wtStaffB)
	}
}
