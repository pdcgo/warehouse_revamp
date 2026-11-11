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

// THE TRANSFER'S TIMELINE READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): Root opening it for a seller they
// are not in reads is_override on the create row; the warehouse staff's process row does not.
func TestWarehouseTransferDetail_ReadsTheOverrideStamp(t *testing.T) {
	f := wtStocked(t)

	res, err := f.svc.WarehouseTransferCreate(ctxAs(ovRoot, otMelati, rootOutsideRole),
		connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 1)},
		}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := res.Msg.GetTransfer().GetId()

	_, err = f.svc.WarehouseTransferProcess(ctxAs(wtStaffA, wtA, staffRole),
		connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{TeamId: wtA, TransferId: id}))
	if err != nil {
		t.Fatalf("process: %v", err)
	}

	got, err := f.svc.WarehouseTransferDetail(ctxUser(1), connect.NewRequest(&inventoryv1.WarehouseTransferDetailRequest{
		TeamId: otMelati, TransferId: id,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	logs := got.Msg.GetTransfer().GetLogs()
	if len(logs) != 2 {
		t.Fatalf("%d trail rows, want 2 (create, process)", len(logs))
	}

	for _, l := range logs {
		want := l.GetActorUserId() == ovRoot
		if l.GetIsOverride() != want {
			t.Errorf("trail row %d by %d: is_override = %v, want %v", l.GetId(), l.GetActorUserId(), l.GetIsOverride(), want)
		}
	}
}
