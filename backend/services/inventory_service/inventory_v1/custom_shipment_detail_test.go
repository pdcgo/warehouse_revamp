package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// The owning selling team reads its parcel in full — lines, trail and its money: the sample's batch value (which the
// team sees, the-custom-shipments-prototype-is-accepted), each line's, the account and the cost.
func TestCustomShipmentDetail_TheOwningTeamReadsItAll(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 3), csProduct(wtKaosPolos, 1)))

	cs, err := f.detail(otMelati, created.GetId())
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if cs.GetTotal() != 37000 || cs.GetFinanceAccountId() != wtAccount || cs.GetShippingCost() != 15000 ||
		csItemOf(t, cs, wtKaosHitam).GetTotal() != 32000 || len(cs.GetLogs()) != 1 || len(cs.GetItems()) != 2 {
		t.Fatalf("detail = %+v, want Melati's sample with its money, two lines and one trail row", cs)
	}

	got := moneySet(cs.ProtoReflect(), "")
	slices.Sort(got)

	want := []string{"finance_account_id", "items[].total", "items[].total", "shipping_cost", "total"}
	if !slices.Equal(got, want) {
		t.Fatalf("money the owner receives = %v, want %v", got, want)
	}
}

// ⚠ THE WAREHOUSE RECEIVES NO SELLER MONEY — on screen or in the data (a-warehouse-sees-no-seller-money, the-custom-
// shipments-prototype-is-accepted). Reading Melati's sample that Melati pays the courier for, Gudang 5 receives no
// value, no line value, no account and no cost: the fields are UNSET, not zero, in what it gets — while it still gets
// the lines, the recipient, the trail and the take to pick from.
func TestCustomShipmentDetail_TheWarehouseReceivesNoSellerMoney(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 3), csProduct(wtKaosPolos, 1)))

	cs, err := f.detail(wtA, created.GetId())
	if err != nil {
		t.Fatalf("detail as the warehouse: %v", err)
	}

	if money := moneySet(cs.ProtoReflect(), ""); len(money) != 0 {
		t.Fatalf("the warehouse received seller money: %v", money)
	}

	if cs.Total != nil || cs.ShippingCost != nil || cs.GetItems()[0].Total != nil {
		t.Fatal("a money field is set (even to 0) for the warehouse")
	}

	if len(cs.GetItems()) != 2 || cs.GetRecipient().GetName() != "Budi" || len(cs.GetLogs()) != 1 ||
		cs.GetTransactionId() != created.GetTransactionId() || cs.GetTransactionId() == 0 {
		t.Fatalf("detail = %+v, want the lines, the recipient, the trail and the take", cs)
	}
}

// When the WAREHOUSE pays the courier, the cost is the ongkir it pays — the one money figure it reads
// (the-warehouse-sees-the-ongkir-it-paid): set, 0 until the handover. Nothing else.
func TestCustomShipmentDetail_TheWarehouseReadsTheOngkirItPays(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 2)))

	cs, err := f.detail(wtA, created.GetId())
	if err != nil {
		t.Fatalf("detail as the warehouse: %v", err)
	}

	if money := moneySet(cs.ProtoReflect(), ""); len(money) != 1 || money[0] != "shipping_cost" || cs.ShippingCost == nil ||
		cs.GetShippingCost() != 0 {
		t.Fatalf("money the warehouse receives on a parcel it pays the courier for = %v, want only shipping_cost at 0", money)
	}
}

// A parcel the team is no side of reads as NotFound — another selling team, another warehouse — never "forbidden",
// which would confirm it exists. The root team reads any, in full.
func TestCustomShipmentDetail_AnotherTeamReadsNotFoundRootReadsAll(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 1)))

	for _, team := range []uint64{otSinar, wtB} {
		_, err := f.detail(team, created.GetId())
		wantCode(t, err, connect.CodeNotFound, "team "+itoa(team))
	}

	_, err := f.detail(otMelati, created.GetId()+1000)
	wantCode(t, err, connect.CodeNotFound, "an id that exists nowhere")

	cs, err := f.detail(san_auth.RootTeamID, created.GetId())
	if err != nil {
		t.Fatalf("detail as root: %v", err)
	}

	if cs.GetTotal() != 10000 || cs.GetFinanceAccountId() != wtAccount {
		t.Fatalf("root reads %+v, want the whole parcel with its money", cs)
	}
}

// The trail names an override: Root creating for Melati from outside the team is stamped on the create's row
// (an-override-is-stamped-in-every-service), and the event says so.
func TestCustomShipmentDetail_TheTrailReadsTheOverrideStamp(t *testing.T) {
	f := csStocked(t)

	res, err := f.svc.CustomShipmentCreate(ctxAs(ovRoot, otMelati, rootOutsideRole),
		connect.NewRequest(csSample("k-1", csProduct(wtKaosHitam, 1))))
	if err != nil {
		t.Fatalf("create as root: %v", err)
	}

	cs, err := f.detail(otMelati, res.Msg.GetCustomShipment().GetId())
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if logs := cs.GetLogs(); len(logs) != 1 || logs[0].GetActorUserId() != ovRoot || !logs[0].GetIsOverride() {
		t.Fatalf("trail = %+v, want Root's create stamped as an override", logs)
	}

	if events := f.customShipmentEvents(); len(events) != 1 || !events[0].GetCustomShipmentCreated().GetActorIsOverride() {
		t.Fatalf("events = %v, want one Created carrying the override", events)
	}

	_, override := lastTransactionOverride(t, f.db, "sample")
	if !override {
		t.Fatal("the sample's take is not stamped as an override")
	}
}

// Every reader sees the same parcel otherwise: the warehouse's read equals the owner's with the money taken out.
func TestCustomShipmentDetail_TheWarehouseReadIsTheOwnersWithoutMoney(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 2)))

	owner, err := f.detail(otMelati, created.GetId())
	if err != nil {
		t.Fatalf("owner: %v", err)
	}

	warehouse, err := f.detail(wtA, created.GetId())
	if err != nil {
		t.Fatalf("warehouse: %v", err)
	}

	owner.Total, owner.ShippingCost, owner.FinanceAccountId = nil, nil, 0
	for _, item := range owner.GetItems() {
		item.Total = nil
	}

	if !proto.Equal(owner, warehouse) {
		t.Fatalf("the warehouse's read differs beyond the money:\nowner     %v\nwarehouse %v", owner, warehouse)
	}

	if warehouse.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED || warehouse.GetId() != created.GetId() {
		t.Fatalf("warehouse read = %v, want the requested parcel %d", warehouse, created.GetId())
	}
}
