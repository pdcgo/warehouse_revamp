package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// Only A confirms, only from created, once — and the confirm is on the trail with who did it.
func TestWarehouseTransferProcess_OnlyTheSenderFromCreated(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 1))

	process := func(team uint64) (*inventoryv1.WarehouseTransfer, error) {
		res, err := f.svc.WarehouseTransferProcess(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{
			TeamId: team, TransferId: tr.GetId(),
		}))
		if err != nil {
			return nil, err
		}

		return res.Msg.GetTransfer(), nil
	}

	for _, team := range []uint64{wtB, otMelati} {
		_, err := process(team)
		wantCode(t, err, connect.CodeNotFound, "processed by a team that is not A")
	}

	got, err := process(wtA)
	if err != nil {
		t.Fatalf("process: %v", err)
	}

	if got.GetStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_PROCESS ||
		got.GetProcessedByUserId() != wtStaffA || got.GetProcessedAtUnix() == 0 {
		t.Fatalf("transfer = %v by %d at %d, want process by %d",
			got.GetStatus(), got.GetProcessedByUserId(), got.GetProcessedAtUnix(), wtStaffA)
	}

	logs := got.GetLogs()
	last := logs[len(logs)-1]

	if last.GetFromStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_CREATED ||
		last.GetToStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_PROCESS || last.GetActorUserId() != wtStaffA {
		t.Fatalf("last trail row = %+v, want created → process by %d", last, wtStaffA)
	}

	_, err = process(wtA)
	wantCode(t, err, connect.CodeFailedPrecondition, "processed twice")
}
