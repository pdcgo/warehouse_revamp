package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// *Gudang bayar*: A hands Melati's reship to the courier and types what it paid on the spot, Rp 12.000, with the resi.
// Picked → handed over, stamped; the cost is stored and A reads it back (the ongkir it paid); Melati reads it too; and
// CustomShipmentHandedOver carries it for Team Balance (the-courier-is-paid-by-the-team-or-by-the-warehouse).
func TestCustomShipmentHandover_TheWarehouseTypesWhatItPaid(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 2)))
	f.mustPick(t, created.GetId())

	cs, err := f.handover(wtA, created.GetId(), rupiah(12000), "  JNE-0001  ")
	if err != nil {
		t.Fatalf("handover: %v", err)
	}

	wantStatus(t, cs, inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_HANDED_OVER)

	if cs.GetHandedOverByUserId() != wtStaffA || cs.GetHandedOverAtUnix() == 0 || cs.GetResi() != "JNE-0001" {
		t.Fatalf("handed over by %d at %d, resi %q — want by %d, JNE-0001", cs.GetHandedOverByUserId(),
			cs.GetHandedOverAtUnix(), cs.GetResi(), wtStaffA)
	}

	if cs.ShippingCost == nil || cs.GetShippingCost() != 12000 {
		t.Fatalf("A reads the cost as %v (set %v), want the 12000 it paid", cs.GetShippingCost(), cs.ShippingCost != nil)
	}

	owner, err := f.detail(otMelati, cs.GetId())
	if err != nil {
		t.Fatalf("owner's detail: %v", err)
	}

	if owner.GetShippingCost() != 12000 {
		t.Fatalf("Melati reads the cost as %v, want 12000", owner.GetShippingCost())
	}

	if logs := cs.GetLogs(); len(logs) != 3 ||
		logs[2].GetFromStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_PICKED ||
		logs[2].GetToStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_HANDED_OVER {
		t.Fatalf("trail = %+v, want …, picked → handed over", logs)
	}

	events := f.customShipmentEvents()
	last := events[len(events)-1]
	got := last.GetCustomShipmentHandedOver()

	if last.GetEventId() != "custom-shipment-handed-over:"+itoa(cs.GetId()) || got == nil ||
		got.GetWarehouseCost() != 12000 || got.GetTeamId() != otMelati || got.GetWarehouseId() != wtA ||
		got.GetPayer() != inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE ||
		got.GetKind() != inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP ||
		got.GetActorId() != wtStaffA || got.GetHandedOverAtUnix() == 0 {
		t.Fatalf("event %s = %+v, want A's 12000 owed by Melati", last.GetEventId(), got)
	}
}

// The warehouse's cost is REQUIRED — an empty field is not 0, refused and nothing moves — and 0 is a real answer (it
// paid nothing; the event carries 0 and Team Balance posts nothing).
func TestCustomShipmentHandover_TheWarehousesCostIsRequiredZeroAllowed(t *testing.T) {
	f := csStocked(t)
	cs := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 1)))
	f.mustPick(t, cs.GetId())
	events := len(f.customShipmentEvents())

	_, err := f.handover(wtA, cs.GetId(), nil, "JNE-1")
	wantCode(t, err, connect.CodeInvalidArgument, "the warehouse pays and typed no cost")

	var stored models.CustomShipment
	f.db.First(&stored, cs.GetId())

	if stored.Status != models.CustomShipmentPicked || stored.Resi != "" || len(f.customShipmentEvents()) != events {
		t.Fatalf("a refused handover wrote %+v or published", stored)
	}

	handed, err := f.handover(wtA, cs.GetId(), rupiah(0), "")
	if err != nil {
		t.Fatalf("handover at 0: %v", err)
	}

	if handed.ShippingCost == nil || handed.GetShippingCost() != 0 {
		t.Fatalf("cost = %v (set %v), want 0 set", handed.GetShippingCost(), handed.ShippingCost != nil)
	}

	got := f.customShipmentEvents()[len(f.customShipmentEvents())-1].GetCustomShipmentHandedOver()
	if got == nil || got.GetWarehouseCost() != 0 {
		t.Fatalf("event = %+v, want a handover carrying 0", got)
	}
}

// *Kami bayar*: the team's own cost stands — a cost from the warehouse is refused, and without one the handover goes
// through, the team's Rp 15.000 untouched and never sent to A; the event carries 0 (its cost was posted as an expense).
func TestCustomShipmentHandover_TheTeamPaysNoCostIsTaken(t *testing.T) {
	f := csStocked(t)
	cs := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 1)))
	f.mustPick(t, cs.GetId())

	_, err := f.handover(wtA, cs.GetId(), rupiah(9000), "")
	wantCode(t, err, connect.CodeInvalidArgument, "a cost typed when the team pays")

	handed, err := f.handover(wtA, cs.GetId(), nil, "")
	if err != nil {
		t.Fatalf("handover: %v", err)
	}

	wantStatus(t, handed, inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_HANDED_OVER)

	if set := moneySet(handed.ProtoReflect(), ""); len(set) != 0 {
		t.Fatalf("A's answer carries the team's money: %v", set)
	}

	var stored models.CustomShipment
	f.db.First(&stored, cs.GetId())

	if stored.ShippingCost != 15000 || stored.FinanceAccountID != wtAccount || stored.Resi != "" {
		t.Fatalf("stored = cost %v account %d resi %q, want the team's 15000 from 77 untouched", stored.ShippingCost,
			stored.FinanceAccountID, stored.Resi)
	}

	got := f.customShipmentEvents()[len(f.customShipmentEvents())-1].GetCustomShipmentHandedOver()
	if got == nil || got.GetWarehouseCost() != 0 || got.GetPayer() != inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM {
		t.Fatalf("event = %+v, want the team-paid handover carrying 0", got)
	}
}

// Only the warehouse it ships from hands over — the owning team and another warehouse read NotFound — and only once
// picked: Diminta, or already handed over, is refused.
func TestCustomShipmentHandover_OnlyTheShippingWarehouseOnlyOncePicked(t *testing.T) {
	f := csStocked(t)
	cs := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 1)))

	_, err := f.handover(wtA, cs.GetId(), rupiah(5000), "")
	wantCode(t, err, connect.CodeFailedPrecondition, "handed over while requested")

	f.mustPick(t, cs.GetId())

	_, err = f.handover(otMelati, cs.GetId(), rupiah(5000), "")
	wantCode(t, err, connect.CodeNotFound, "handed over by the owning team")

	_, err = f.handover(wtB, cs.GetId(), rupiah(5000), "")
	wantCode(t, err, connect.CodeNotFound, "handed over by another warehouse")

	_, err = f.handover(wtA, cs.GetId(), rupiah(5000), "")
	if err != nil {
		t.Fatalf("handover: %v", err)
	}

	_, err = f.handover(wtA, cs.GetId(), rupiah(7000), "")
	wantCode(t, err, connect.CodeFailedPrecondition, "handed over twice")

	var stored models.CustomShipment
	f.db.First(&stored, cs.GetId())

	if stored.ShippingCost != 5000 {
		t.Fatalf("the second handover changed the cost to %v", stored.ShippingCost)
	}
}
