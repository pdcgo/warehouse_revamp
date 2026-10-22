package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// The owning team, A and B each read the whole transfer, trail and pick list included; a fourth team reads NotFound.
func TestWarehouseTransferDetail_EverySideReadsItAndNoOneElse(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 3))

	for _, team := range []uint64{otMelati, wtA, wtB} {
		res, err := f.svc.WarehouseTransferDetail(ctxUser(1), connect.NewRequest(&inventoryv1.WarehouseTransferDetailRequest{
			TeamId: team, TransferId: tr.GetId(),
		}))
		if err != nil {
			t.Fatalf("detail as team %d: %v", team, err)
		}

		got := res.Msg.GetTransfer()
		if len(got.GetLogs()) != 1 || len(itemOf(t, got, wtKaosHitam).GetPicks()) == 0 {
			t.Fatalf("detail as team %d = %+v, want its trail and its pick list", team, got)
		}
	}

	_, err := f.svc.WarehouseTransferDetail(ctxUser(1), connect.NewRequest(&inventoryv1.WarehouseTransferDetailRequest{
		TeamId: wtOther, TransferId: tr.GetId(),
	}))
	wantCode(t, err, connect.CodeNotFound, "read by a fourth team")
}
