package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// Gudang 5 (A) has picked and packed Melati's sample: Diminta → picked, stamped with who and when, a trail row, and no
// ledger write (the units left at create) and no event. A's answer carries no seller money.
func TestCustomShipmentPicked_TheShippingWarehouseMovesItToPicked(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 3)))
	events := len(f.customShipmentEvents())

	cs, err := f.picked(wtA, created.GetId())
	if err != nil {
		t.Fatalf("picked: %v", err)
	}

	wantStatus(t, cs, inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_PICKED)

	if cs.GetPickedByUserId() != wtStaffA || cs.GetPickedAtUnix() == 0 {
		t.Fatalf("picked by %d at %d, want by %d", cs.GetPickedByUserId(), cs.GetPickedAtUnix(), wtStaffA)
	}

	if logs := cs.GetLogs(); len(logs) != 2 ||
		logs[1].GetFromStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED ||
		logs[1].GetToStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_PICKED ||
		logs[1].GetActorUserId() != wtStaffA {
		t.Fatalf("trail = %+v, want requested → picked by %d", logs, wtStaffA)
	}

	if set := moneySet(cs.ProtoReflect(), ""); len(set) != 0 {
		t.Fatalf("the warehouse's answer carries seller money: %v", set)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 4 || r != 4 {
		t.Fatalf("A holds %d / %d Kaos Hitam, want 4 — the pick moves nothing", b, r)
	}

	if len(f.customShipmentEvents()) != events {
		t.Fatal("a pick published an event")
	}
}

// Only the warehouse it ships from picks — the owning team and another warehouse read NotFound — and only while Diminta:
// twice, or after a cancel, is refused.
func TestCustomShipmentPicked_OnlyTheShippingWarehouseOnlyWhileRequested(t *testing.T) {
	f := csStocked(t)
	cs := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 1)))

	_, err := f.picked(otMelati, cs.GetId())
	wantCode(t, err, connect.CodeNotFound, "picked by the owning team")

	_, err = f.picked(wtB, cs.GetId())
	wantCode(t, err, connect.CodeNotFound, "picked by another warehouse")

	f.mustPick(t, cs.GetId())

	_, err = f.picked(wtA, cs.GetId())
	wantCode(t, err, connect.CodeFailedPrecondition, "picked twice")

	cancelled := f.mustCreate(t, csSample("k-2", csProduct(wtKaosPolos, 1)))

	_, err = f.cancel(otMelati, cancelled.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err = f.picked(wtA, cancelled.GetId())
	wantCode(t, err, connect.CodeFailedPrecondition, "picked once cancelled")
}
