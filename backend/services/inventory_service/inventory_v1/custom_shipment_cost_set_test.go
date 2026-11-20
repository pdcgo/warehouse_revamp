package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/prototext"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// *Ubah Ongkir* — Melati pays its own courier (*Kami bayar*) and edits the cost until the handover: Rp 15.000 → 20.000
// while Diminta, then → 18.000 once picked. Each edit that moved money bumps the revision, leaves a trail row whose from
// equals its to saying what moved, and announces both sides under its own revision. An edit that changes nothing writes
// and publishes nothing. Once handed over, the cost is final (the-courier-is-paid-by-the-team-or-by-the-warehouse).
func TestCustomShipmentCostSet_EditsTheTeamsCostUntilTheHandover(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 1)))
	id := created.GetId()

	cs, err := f.costSet(otMelati, id, wtAccount, 20000)
	if err != nil {
		t.Fatalf("cost set: %v", err)
	}

	wantStatus(t, cs, inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED)

	if cs.GetShippingCost() != 20000 || cs.GetFinanceAccountId() != wtAccount {
		t.Fatalf("cost = %v from %d, want 20000 from 77", cs.GetShippingCost(), cs.GetFinanceAccountId())
	}

	logs := cs.GetLogs()
	if len(logs) != 2 || logs[1].GetFromStatus() != logs[1].GetToStatus() ||
		logs[1].GetToStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED ||
		logs[1].GetDescription() != "Rp 15.000 → Rp 20.000" || logs[1].GetActorUserId() != wtSeller {
		t.Fatalf("trail = %+v, want an edit row (requested → requested) saying Rp 15.000 → Rp 20.000", logs)
	}

	events := f.customShipmentEvents()
	first := events[len(events)-1]
	got := first.GetCustomShipmentCostUpdated()

	if first.GetEventId() != "custom-shipment-cost-updated:"+itoa(id)+":1" || got == nil ||
		got.GetOldFinanceAccountId() != wtAccount || got.GetNewFinanceAccountId() != wtAccount ||
		got.GetOldAmount() != 15000 || got.GetNewAmount() != 20000 || got.GetTeamId() != otMelati ||
		got.GetActorId() != wtSeller || got.GetUpdatedAtUnix() == 0 {
		t.Fatalf("event %s = %+v, want revision 1, 77: 15000 → 20000", first.GetEventId(), got)
	}

	// The same figures again move nothing: no row, no revision, no event.
	before := len(f.customShipmentEvents())

	cs, err = f.costSet(otMelati, id, wtAccount, 20000)
	if err != nil {
		t.Fatalf("cost set (unchanged): %v", err)
	}

	if len(cs.GetLogs()) != 2 || len(f.customShipmentEvents()) != before {
		t.Fatalf("an unchanged edit wrote %d rows / published %d", len(cs.GetLogs())-2, len(f.customShipmentEvents())-before)
	}

	// Still the team's to edit once picked.
	f.mustPick(t, id)

	cs, err = f.costSet(otMelati, id, wtAccount, 18000)
	if err != nil {
		t.Fatalf("cost set while picked: %v", err)
	}

	if cs.GetShippingCost() != 18000 || f.lastCustomShipmentEvent(t) != "custom-shipment-cost-updated:"+itoa(id)+":2" {
		t.Fatalf("cost %v, last event %s — want 18000 under revision 2", cs.GetShippingCost(), f.lastCustomShipmentEvent(t))
	}

	var stored models.CustomShipment
	f.db.First(&stored, id)

	if stored.CostRevision != 2 || stored.ShippingCost != 18000 {
		t.Fatalf("stored revision %d cost %v, want 2 and 18000", stored.CostRevision, stored.ShippingCost)
	}

	_, err = f.handover(wtA, id, nil, "")
	if err != nil {
		t.Fatalf("handover: %v", err)
	}

	_, err = f.costSet(otMelati, id, wtAccount, 25000)
	wantCode(t, err, connect.CodeFailedPrecondition, "a cost edit once handed over")

	f.db.First(&stored, id)
	if stored.ShippingCost != 18000 || stored.CostRevision != 2 {
		t.Fatalf("a refused edit changed the cost to %v (revision %d)", stored.ShippingCost, stored.CostRevision)
	}
}

// A courier the warehouse pays has no account and no cost of the team's to edit — refused, nothing written. Only the
// owning team edits: the warehouse and another team read NotFound. A cancelled parcel is not edited.
func TestCustomShipmentCostSet_OnlyTheOwningTeamOnlyWhenItPays(t *testing.T) {
	f := csStocked(t)
	reship := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 1)))

	_, err := f.costSet(otMelati, reship.GetId(), wtAccount, 10000)
	wantCode(t, err, connect.CodeFailedPrecondition, "a cost edit when the warehouse pays")

	var stored models.CustomShipment
	f.db.First(&stored, reship.GetId())

	if stored.FinanceAccountID != 0 || stored.ShippingCost != 0 || stored.CostRevision != 0 {
		t.Fatalf("a refused edit wrote %+v", stored)
	}

	sample := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 1)))

	_, err = f.costSet(wtA, sample.GetId(), wtAccount, 10000)
	wantCode(t, err, connect.CodeNotFound, "a cost edit by the warehouse")

	_, err = f.costSet(otSinar, sample.GetId(), wtAccount, 10000)
	wantCode(t, err, connect.CodeNotFound, "a cost edit by another team")

	_, err = f.costSet(otMelati, sample.GetId(), 0, 10000)
	wantCode(t, err, connect.CodeInvalidArgument, "a cost edit naming no account")

	_, err = f.cancel(otMelati, sample.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err = f.costSet(otMelati, sample.GetId(), wtAccount, 10000)
	wantCode(t, err, connect.CodeFailedPrecondition, "a cost edit once cancelled")
}

// A CHANGED account must be one of the team's active accounts, operational or not (as a transfer's shipping): an
// archived one is refused and nothing moves; an active one that is not operational is taken, and the event carries both
// accounts. An UNCHANGED account is not asked again.
func TestCustomShipmentCostSet_AChangedAccountMustBeActive(t *testing.T) {
	f := csStocked(t)
	f.svc = newCustomShipmentServiceWithAccounts(f)

	req := csSample("k-1", csProduct(wtKaosHitam, 1))
	req.FinanceAccountId = accountOperational

	cs := f.mustCreate(t, req)

	_, err := f.costSet(otMelati, cs.GetId(), accountArchived, 20000)
	wantCode(t, err, connect.CodeFailedPrecondition, "moved to an archived account")

	if !strings.Contains(err.Error(), "Mandiri Lama") {
		t.Fatalf("refusal %q does not name the account", err)
	}

	moved, err := f.costSet(otMelati, cs.GetId(), accountPlain, 20000)
	if err != nil {
		t.Fatalf("moved to an active account: %v", err)
	}

	if moved.GetFinanceAccountId() != accountPlain {
		t.Fatalf("account = %d, want %d", moved.GetFinanceAccountId(), accountPlain)
	}

	got := f.customShipmentEvents()[len(f.customShipmentEvents())-1].GetCustomShipmentCostUpdated()
	if got.GetOldFinanceAccountId() != accountOperational || got.GetNewFinanceAccountId() != accountPlain ||
		got.GetOldAmount() != 15000 || got.GetNewAmount() != 20000 {
		t.Fatalf("event = %+v, want %d: 15000 back, %d pays 20000", got, accountOperational, accountPlain)
	}
}

// THE WAREHOUSE READS THAT THE COST WAS EDITED, NEVER THE FIGURES (a-warehouse-sees-no-seller-money): the edit row's
// "Rp 15.000 → Rp 20.000" is the team's own money — the owner reads it, the shipping warehouse reads the row without
// it, and no seller-money field is set anywhere in what it receives.
func TestCustomShipmentCostSet_TheWarehouseNeverReadsTheTeamsFigures(t *testing.T) {
	f := csStocked(t)
	cs := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 1)))

	_, err := f.costSet(otMelati, cs.GetId(), wtAccount, 20000)
	if err != nil {
		t.Fatalf("cost set: %v", err)
	}

	owner, err := f.detail(otMelati, cs.GetId())
	if err != nil {
		t.Fatalf("owner's detail: %v", err)
	}

	if owner.GetLogs()[1].GetDescription() != "Rp 15.000 → Rp 20.000" {
		t.Fatalf("the owner's edit row = %+v, want the figures", owner.GetLogs()[1])
	}

	picked, err := f.picked(wtA, cs.GetId())
	if err != nil {
		t.Fatalf("picked: %v", err)
	}

	warehouse, err := f.detail(wtA, cs.GetId())
	if err != nil {
		t.Fatalf("warehouse's detail: %v", err)
	}

	for _, read := range []*inventoryv1.CustomShipment{picked, warehouse} {
		edit := read.GetLogs()[1]
		if edit.GetFromStatus() != edit.GetToStatus() || edit.GetDescription() != "" {
			t.Fatalf("the warehouse's edit row = %+v, want the edit without its figures", edit)
		}

		if set := moneySet(read.ProtoReflect(), ""); len(set) != 0 {
			t.Fatalf("the warehouse receives seller money: %v", set)
		}

		if text := prototext.Format(read); strings.Contains(text, "Rp ") {
			t.Fatalf("the warehouse's read carries the team's figures: %v", read)
		}
	}
}
