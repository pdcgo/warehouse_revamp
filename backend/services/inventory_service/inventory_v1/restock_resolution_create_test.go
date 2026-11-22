package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// a-restock-problem-is-settled-by-resolution-rows, 🔄 A (the refund names its account): a REFUND row carries its amount
// and the account it goes into — any of the team's ACTIVE accounts (42 is not operational) — and after commit
// RestockRefunded names both, keyed by the row so a republish posts once. The selling team reads it whole; the
// receiving warehouse reads the row without the money. A used key is refused, never recorded twice.
func TestRestockResolutionCreate_ARefundNamesItsAmountAndAccount(t *testing.T) {
	f := rsStocked(t)

	res := f.mustResolve(t, rsRefund(f.restock, "refund-1", 25000, accountPlain))
	row := res.GetResolution()

	if row.GetType() != rsRefundType || row.GetRefundAmount() != 25000 || row.GetFinanceAccountId() != accountPlain ||
		row.GetCreatedByUserId() != wtSeller || row.GetRestockId() != f.restock || res.GetCustomShipment() != nil {
		t.Fatalf("refund row = %+v, parcel %v", row, res.GetCustomShipment())
	}

	refunds := eventsOf[*eventsv1.Event_RestockRefunded](f)
	if len(refunds) != 1 {
		t.Fatalf("published %d RestockRefunded, want 1", len(refunds))
	}

	got := refunds[0].RestockRefunded
	if got.GetRestockId() != f.restock || got.GetResolutionId() != row.GetId() || got.GetTeamId() != otMelati ||
		got.GetFinanceAccountId() != accountPlain || got.GetAmount() != 25000 || got.GetActorId() != wtSeller {
		t.Fatalf("RestockRefunded = %+v", got)
	}

	if id := f.sent.events[len(f.sent.events)-1].GetEventId(); id != "restock-refunded:"+itoaU(row.GetId()) {
		t.Fatalf("event id = %q, want one per refund row", id)
	}

	seller := f.restockAs(t, otMelati, wtSeller, f.restock)
	if seller.GetResolutionCount() != 1 || len(seller.GetResolutions()) != 1 ||
		seller.GetResolutions()[0].GetRefundAmount() != 25000 || seller.GetResolutions()[0].GetFinanceAccountId() != accountPlain {
		t.Fatalf("the seller's restock reads %v", seller.GetResolutions())
	}

	// a-warehouse-sees-no-seller-money: the row, never the refund.
	warehouse := f.restockAs(t, wtA, wtStaffA, f.restock)
	if len(warehouse.GetResolutions()) != 1 || warehouse.GetResolutions()[0].RefundAmount != nil ||
		warehouse.GetResolutions()[0].GetFinanceAccountId() != 0 || warehouse.GetResolutions()[0].GetType() != rsRefundType {
		t.Fatalf("the warehouse reads %v", warehouse.GetResolutions())
	}

	// A double tap: refused, nothing more recorded or published.
	_, err := f.resolve(rsRefund(f.restock, "refund-1", 25000, accountPlain))
	codeOf(t, "a used key", err, connect.CodeAlreadyExists)

	if n := len(eventsOf[*eventsv1.Event_RestockRefunded](f)); n != 1 {
		t.Fatalf("a refused double tap published: %d refunds", n)
	}

	// An archived account, another team's: refused as the transfer's Paid from is, nothing written.
	_, err = f.resolve(rsRefund(f.restock, "refund-2", 1000, accountArchived))
	codeOf(t, "an archived account", err, connect.CodeFailedPrecondition)

	_, err = f.resolve(rsRefund(f.restock, "refund-3", 1000, accountOtherTeams))
	codeOf(t, "another team's account", err, connect.CodeFailedPrecondition)

	// Each type carries its own fields and nothing of the others'.
	_, err = f.resolve(rsRefund(f.restock, "refund-4", 0, accountPlain))
	codeOf(t, "a refund of nothing", err, connect.CodeInvalidArgument)

	bad := rsRefund(f.restock, "refund-5", 1000, accountPlain)
	bad.CustomShipmentId = 1
	_, err = f.resolve(bad)
	codeOf(t, "a refund naming a parcel", err, connect.CodeInvalidArgument)

	if n := len(f.restockAs(t, otMelati, wtSeller, f.restock).GetResolutions()); n != 1 {
		t.Fatalf("after the refusals the restock has %d rows, want 1", n)
	}
}

// Who and what takes resolutions (a-restock-problem-is-settled-by-resolution-rows + 🔄 A, a lost restock takes them
// too): a received restock carrying a problem tag, or a lost one — never one on its way, nor one received whole; another
// team's reads NotFound; a lost restock takes a refund and a reshipping but no return (nothing arrived to send back).
func TestRestockResolutionCreate_OnlyAProblemOrALostRestockTakesOne(t *testing.T) {
	f := rsStocked(t)

	_, err := f.resolve(rsRefund(f.ongoing, "on-its-way", 1000, accountPlain))
	codeOf(t, "a restock on its way", err, connect.CodeFailedPrecondition)

	_, err = f.resolve(rsRefund(f.cleanRestock(t), "clean", 1000, accountPlain))
	codeOf(t, "a restock received whole", err, connect.CodeFailedPrecondition)

	_, err = f.resolve(rsRefund(f.sinarRestock, "sinar", 1000, accountPlain))
	codeOf(t, "another team's restock", err, connect.CodeNotFound)

	lost := f.lostRestock(t)

	f.mustResolve(t, rsRefund(lost, "lost-refund", 400000, accountOperational))
	f.mustResolve(t, rsReshipping(lost, "lost-reship", rsLine(csWidget, 2, 10000)))

	_, err = f.resolve(rsReturn(lost, "lost-return", 1))
	codeOf(t, "a return on a lost restock", err, connect.CodeFailedPrecondition)

	if n := f.restockAs(t, otMelati, wtSeller, lost).GetResolutionCount(); n != 2 {
		t.Fatalf("the lost restock has %d rows, want the refund and the reshipping", n)
	}
}

// A RETURN rides an outbound reship (🔄 A: return = the goods back to the supplier): made WITH its row on the existing
// Paket Baru path, or an existing reship of the restock linked — once, never a cancelled one. The parcel reads its row;
// a sample is never a return.
func TestRestockResolutionCreate_AReturnRidesAReship(t *testing.T) {
	f := rsStocked(t)

	// Paket Baru on *Kirim balik ke supplier*, as the restock's return.
	req := f.csReship("return-new", csRestockLine(f.line[csWidget], 2))
	req.Resolution = &inventoryv1.CustomShipmentReturnResolution{Note: "send the crushed ones back"}
	made := f.mustCreate(t, req)

	if made.GetResolutionId() == 0 || made.GetDirection() != inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_OUTBOUND {
		t.Fatalf("the return's parcel reads resolution %d, direction %s", made.GetResolutionId(), made.GetDirection())
	}

	rows := f.restockAs(t, otMelati, wtSeller, f.restock).GetResolutions()
	if len(rows) != 1 || rows[0].GetType() != rsReturnType || rows[0].GetCustomShipmentId() != made.GetId() ||
		rows[0].GetNote() != "send the crushed ones back" || rows[0].GetId() != made.GetResolutionId() ||
		rows[0].GetInventoryTransactionId() != 0 {
		t.Fatalf("restock rows = %v", rows)
	}

	// An existing reship, linked by RestockResolutionCreate — once.
	plain := f.mustCreate(t, f.csReship("reship-plain", csRestockLine(f.line[csGadget], 1)))
	if plain.GetResolutionId() != 0 {
		t.Fatalf("a reship made without a row reads row %d", plain.GetResolutionId())
	}

	linked := f.mustResolve(t, rsReturn(f.restock, "return-link", plain.GetId()))
	if linked.GetCustomShipment().GetId() != plain.GetId() || linked.GetCustomShipment().GetResolutionId() != linked.GetResolution().GetId() {
		t.Fatalf("linked = %v", linked)
	}

	_, err := f.resolve(rsReturn(f.restock, "return-again", plain.GetId()))
	codeOf(t, "a reship already a return", err, connect.CodeFailedPrecondition)

	// A cancelled reship is no return.
	dead := f.mustCreate(t, f.csReship("reship-dead", csRestockLine(f.line[csGadget], 1)))

	_, err = f.svc.CustomShipmentCancel(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentCancelRequest{
		TeamId: otMelati, Id: dead.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err = f.resolve(rsReturn(f.restock, "return-dead", dead.GetId()))
	codeOf(t, "a cancelled reship", err, connect.CodeFailedPrecondition)

	// Not this restock's parcel, nor a sample.
	_, err = f.resolve(rsReturn(f.restock, "return-unknown", 999999))
	codeOf(t, "an unknown parcel", err, connect.CodeNotFound)

	sample := csSample("sample-return", csProduct(wtKaosHitam, 1))
	sample.FinanceAccountId = accountPlain
	sample.Resolution = &inventoryv1.CustomShipmentReturnResolution{}
	_, err = f.create(sample)
	codeOf(t, "a sample as a return", err, connect.CodeInvalidArgument)

	if n := len(f.restockAs(t, otMelati, wtSeller, f.restock).GetResolutions()); n != 2 {
		t.Fatalf("the restock has %d rows, want the two returns", n)
	}
}

// A RESHIPPING creates its INBOUND parcel in the same step (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A):
// on its way from the restock's supplier to the restock's warehouse (or another chosen), the lines as typed — the
// team's own products, each once, at the seller's price — the warehouse paying the courier at the door; the parcel names
// its row, and the warehouse reads it without a price.
func TestRestockResolutionCreate_AReshippingCreatesItsInboundParcel(t *testing.T) {
	f := rsStocked(t)

	res := f.mustResolve(t, rsReshipping(f.restock, "reship-1", rsLine(csWidget, 3, 9000), rsLine(wtKaosHitam, 2, 5000)))
	cs := res.GetCustomShipment()

	if cs.GetKind() != inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SUPPLIER_RESHIPPING ||
		cs.GetDirection() != inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_INBOUND ||
		cs.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_ON_THE_WAY ||
		cs.GetWarehouseId() != wtA || cs.GetTeamId() != otMelati || cs.GetRestockId() != f.restock ||
		cs.GetPayer() != inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE || cs.GetResi() != "JNE-1" ||
		cs.GetShipmentChannelId() != csCourier || cs.GetResolutionId() != res.GetResolution().GetId() ||
		cs.GetTotal() != 37000 || cs.GetSupplierId() != 0 {
		t.Fatalf("inbound parcel = %v", cs)
	}

	if w := csItemOf(t, cs, csWidget); w.GetQuantity() != 3 || w.GetPriceUnit() != 9000 || w.GetName() != "Widget" ||
		w.Received != nil {
		t.Fatalf("Widget line = %v", w)
	}

	if res.GetResolution().GetCustomShipmentId() != cs.GetId() || res.GetResolution().GetType() != rsReshippingType {
		t.Fatalf("row = %v", res.GetResolution())
	}

	// Announced as every parcel is — the warehouse pays, so nothing posts; no refund.
	created := eventsOf[*eventsv1.Event_CustomShipmentCreated](f)
	if len(created) != 1 || created[0].CustomShipmentCreated.GetAmount() != 0 ||
		created[0].CustomShipmentCreated.GetPayer() != inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE ||
		len(eventsOf[*eventsv1.Event_RestockRefunded](f)) != 0 {
		t.Fatalf("published %v", f.sent.events)
	}

	// The warehouse it comes to: no seller price, no value, in any field.
	seen, err := f.detail(wtA, cs.GetId())
	if err != nil {
		t.Fatalf("warehouse detail: %v", err)
	}

	if set := inboundMoneySet(seen.ProtoReflect(), ""); len(set) != 0 {
		t.Fatalf("the warehouse receives seller money: %v", set)
	}

	// The supplier: the one every line names, else 0 — or one a line names, when asked.
	asked := rsReshipping(f.restock, "reship-31", rsLine(csWidget, 1, 9000))
	asked.Reshipping.SupplierId = csSupplierA
	asked.Reshipping.WarehouseId = wtB

	if got := f.mustResolve(t, asked).GetCustomShipment(); got.GetSupplierId() != csSupplierA || got.GetWarehouseId() != wtB {
		t.Fatalf("asked supplier / warehouse = %d / %d", got.GetSupplierId(), got.GetWarehouseId())
	}

	asked = rsReshipping(f.restock, "reship-99", rsLine(csWidget, 1, 9000))
	asked.Reshipping.SupplierId = 99
	_, err = f.resolve(asked)
	codeOf(t, "a supplier no line names", err, connect.CodeInvalidArgument)

	_, err = f.resolve(rsReshipping(f.restock, "reship-sinar", rsLine(csSinarWidget, 1, 9000)))
	codeOf(t, "another team's product", err, connect.CodeInvalidArgument)

	_, err = f.resolve(rsReshipping(f.restock, "reship-twice", rsLine(csWidget, 1, 9000), rsLine(csWidget, 2, 9000)))
	codeOf(t, "a product twice", err, connect.CodeInvalidArgument)

	_, err = f.resolve(&inventoryv1.RestockResolutionCreateRequest{
		TeamId: otMelati, RestockId: f.restock, Type: rsReshippingType, IdempotencyKey: "reship-none",
	})
	codeOf(t, "a reshipping without its parcel", err, connect.CodeInvalidArgument)

	if n := f.restockAs(t, otMelati, wtSeller, f.restock).GetResolutionCount(); n != 2 {
		t.Fatalf("rows = %d, want the two reshippings that landed", n)
	}
}

// inboundMoneySet is the seller money an inbound parcel can carry: a line's price and value, the parcel's value, an
// account — `shipping_cost` is NOT one: it is the warehouse's own door charge (the-warehouse-sees-the-ongkir-it-paid).
func inboundMoneySet(m protoreflect.Message, path string) []string {
	var out []string

	m.Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		name := path + string(fd.Name())

		switch {
		case fd.IsList() && fd.Message() != nil:
			list := v.List()
			for i := range list.Len() {
				out = append(out, inboundMoneySet(list.Get(i).Message(), name+"[].")...)
			}
		case fd.Message() != nil && !fd.IsMap():
			out = append(out, inboundMoneySet(v.Message(), name+".")...)
		case fd.Name() == "price_unit" || fd.Name() == "total" || fd.Name() == "finance_account_id" ||
			fd.Name() == "refund_amount":
			out = append(out, name)
		}

		return true
	})

	return out
}

// The policies: the restock's selling team writes resolutions, settles, and edits / gives up its inbound parcel; the
// warehouse it comes to signs for it and counts it in. None is a read — a monitor reads only.
func TestRestockResolution_ThePolicies(t *testing.T) {
	selling := []role_basev1.Role{role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER, role_basev1.Role_ROLE_SELLING_ADMIN, role_basev1.Role_ROLE_SELLING_CS}
	warehouse := []role_basev1.Role{role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER, role_basev1.Role_ROLE_WAREHOUSE_ADMIN, role_basev1.Role_ROLE_WAREHOUSE_STAFF}

	cases := []struct {
		service, rpc string
		roles        []role_basev1.Role
	}{
		{"RestockRequestService", "RestockResolutionCreate", selling},
		{"RestockRequestService", "RestockRequestSettle", selling},
		{"CustomShipmentService", "CustomShipmentResiSet", selling},
		{"CustomShipmentService", "CustomShipmentPricesSet", selling},
		{"CustomShipmentService", "CustomShipmentMarkLost", selling},
		{"CustomShipmentService", "CustomShipmentArrive", warehouse},
		{"CustomShipmentService", "CustomShipmentReceive", warehouse},
	}

	for _, c := range cases {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1." + c.rpc + "Request"))
		if err != nil {
			t.Fatalf("%s: %v", c.rpc, err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", c.rpc)
		}

		got, want := slices.Clone(policy.GetRoles()), slices.Clone(c.roles)
		slices.Sort(got)
		slices.Sort(want)

		if !slices.Equal(got, want) {
			t.Fatalf("%s roles = %v, want %v", c.rpc, got, want)
		}

		m, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1." + c.service + "." + c.rpc))
		if err != nil {
			t.Fatalf("%s: method: %v", c.rpc, err)
		}

		opts, _ := m.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
		if opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
			t.Fatalf("%s is marked a read — a monitor could call it", c.rpc)
		}
	}
}
