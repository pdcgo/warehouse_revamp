package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

func updateTransfer(f *wtFixture, team, id uint64, cost float64, account uint64, note string) (*inventoryv1.WarehouseTransfer, error) {
	res, err := f.svc.WarehouseTransferUpdate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferUpdateRequest{
		TeamId: team, TransferId: id, ShipmentCost: cost, FinanceAccountId: account, Note: note,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTransfer(), nil
}

// The cost is typed after A packed, then corrected: each edit that moved money is announced with both sides and its own
// id; an edit of the note alone is not (the-shipping-expense-reaches-the-account-by-event).
func TestWarehouseTransferUpdate_AnnouncesOnlyAnEditThatMovedMoney(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 2))
	f.process(t, tr.GetId())

	got, err := updateTransfer(f, otMelati, tr.GetId(), 18000, wtAccount, "packed")
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	if got.GetShipmentCost() != 18000 || got.GetFinanceAccountId() != wtAccount || got.GetNote() != "packed" {
		t.Fatalf("transfer = cost %v, account %d, note %q", got.GetShipmentCost(), got.GetFinanceAccountId(), got.GetNote())
	}

	_, err = updateTransfer(f, otMelati, tr.GetId(), 18000, wtAccount, "packed, 2 boxes")
	if err != nil {
		t.Fatalf("note-only update: %v", err)
	}

	_, err = updateTransfer(f, otMelati, tr.GetId(), 20000, wtAccount, "packed, 2 boxes")
	if err != nil {
		t.Fatalf("correction: %v", err)
	}

	events := f.transferEvents()
	if len(events) != 3 {
		t.Fatalf("%d transfer events, want created and two money edits", len(events))
	}

	first, second := events[1].GetWarehouseTransferUpdated(), events[2].GetWarehouseTransferUpdated()

	if first.GetOldAmount() != 0 || first.GetNewAmount() != 18000 || first.GetOldFinanceAccountId() != 0 ||
		first.GetNewFinanceAccountId() != wtAccount || events[1].GetEventId() != "warehouse-transfer-updated:"+itoa(tr.GetId())+":1" {
		t.Fatalf("first edit %s = %+v, want 0 → 18000 on account 77, revision 1", events[1].GetEventId(), first)
	}

	if second.GetOldAmount() != 18000 || second.GetNewAmount() != 20000 ||
		events[2].GetEventId() != "warehouse-transfer-updated:"+itoa(tr.GetId())+":2" {
		t.Fatalf("second edit %s = %+v, want 18000 → 20000, revision 2", events[2].GetEventId(), second)
	}
}

// A cost needs its account; only the owning team edits; nothing changes once accepted.
func TestWarehouseTransferUpdate_RefusesNoAccountAnotherSideAndAnAcceptedTransfer(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosPolos, 1))

	_, err := updateTransfer(f, otMelati, tr.GetId(), 5000, 0, "")
	wantCode(t, err, connect.CodeInvalidArgument, "a cost with no account")

	_, err = updateTransfer(f, wtB, tr.GetId(), 5000, wtAccount, "")
	wantCode(t, err, connect.CodeNotFound, "edited by B")

	f.ship(t, tr.GetId())

	_, err = f.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, wtKaosPolos), 1, 0, f.rakB1))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	_, err = updateTransfer(f, otMelati, tr.GetId(), 5000, wtAccount, "")
	wantCode(t, err, connect.CodeFailedPrecondition, "edited once accepted")
}
