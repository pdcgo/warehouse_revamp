package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE CUSTOM SHIPMENT'S FIXTURE (backlog #88 P1). Melati asks Gudang 5 (A) to send parcels.
//
//	a sample   the transfer fixture's stock at A — Kaos Hitam batch 1: 2 at Rp 10.000 on Rak A · batch 2: 5 at Rp 12.000,
//	           1 on Rak A and 4 on Rak B; Kaos Polos 4 at Rp 5.000 on Rak B; Sinar's Kaos Merah 5 on Rak A
//	a reship   Melati's restock to A, received: Widget 10 from supplier 31 (3 broken, "crushed"), Gadget 5 from supplier
//	           32 (2 broken), Gizmo 4 from supplier 31 (none broken); a second restock still on its way; and Sinar's
//	           restock to A with 2 broken Sinar Widgets

const (
	csWidget uint64 = 741
	csGadget uint64 = 742
	csGizmo  uint64 = 743
	// Sinar's own.
	csSinarWidget uint64 = 744

	csSupplierA uint64 = 31
	csSupplierB uint64 = 32

	csCourier uint64 = 9
)

type csFixture struct {
	*wtFixture

	// Melati's received restock and its lines by product; the one still on its way; Sinar's received one.
	restock      uint64
	line         map[uint64]uint64
	ongoing      uint64
	sinarRestock uint64
	sinarLine    uint64
}

// csStocked is wtStocked plus the restocks a reship sends from, on a service that knows suppliers 31 and 32.
func csStocked(t *testing.T) *csFixture {
	t.Helper()

	f := &csFixture{wtFixture: wtStocked(t), line: map[uint64]uint64{}}
	f.svc = inventory_v1.NewService(f.db, nil, nil, fakeSuppliers{csSupplierA: true, csSupplierB: true}, f.sent.send, csFacts(),
		nil, nil, nil, nil)

	received := csRestock(t, f.svc, otMelati,
		&inventoryv1.RestockRequestItem{ProductId: csWidget, ProductCode: "WG-1", Name: "Widget", Count: 10, Total: 100000, SupplierId: csSupplierA},
		&inventoryv1.RestockRequestItem{ProductId: csGadget, ProductCode: "GD-1", Name: "Gadget", Count: 5, Total: 50000, SupplierId: csSupplierB},
		&inventoryv1.RestockRequestItem{ProductId: csGizmo, ProductCode: "GZ-1", Name: "Gizmo", Count: 4, Total: 40000, SupplierId: csSupplierA},
	)

	for _, item := range received.GetItems() {
		f.line[item.GetProductId()] = item.GetId()
	}

	f.restock = received.GetId()

	_, err := f.svc.RestockRequestAccept(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wtA, RequestId: f.restock,
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: f.line[csWidget], ReceivedCount: 10, BrokenCount: 3, BrokenNote: "crushed", Placements: placedOn(f.rakA, 7)},
			{ItemId: f.line[csGadget], ReceivedCount: 5, BrokenCount: 2, Placements: placedOn(f.rakA, 3)},
			{ItemId: f.line[csGizmo], ReceivedCount: 4, Placements: placedOn(f.rakA, 4)},
		},
	}))
	if err != nil {
		t.Fatalf("accept the restock: %v", err)
	}

	f.ongoing = csRestock(t, f.svc, otMelati,
		&inventoryv1.RestockRequestItem{ProductId: csWidget, ProductCode: "WG-1", Name: "Widget", Count: 2, Total: 20000, SupplierId: csSupplierA},
	).GetId()

	sinar := csRestock(t, f.svc, otSinar,
		&inventoryv1.RestockRequestItem{ProductId: csSinarWidget, ProductCode: "SW-1", Name: "Sinar Widget", Count: 4, Total: 40000, SupplierId: csSupplierA},
	)
	f.sinarRestock = sinar.GetId()
	f.sinarLine = sinar.GetItems()[0].GetId()

	_, err = f.svc.RestockRequestAccept(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wtA, RequestId: f.sinarRestock,
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: f.sinarLine, ReceivedCount: 4, BrokenCount: 2, Placements: placedOn(f.rakA, 2)},
		},
	}))
	if err != nil {
		t.Fatalf("accept Sinar's restock: %v", err)
	}

	// Only what the custom shipment itself publishes is asserted on.
	f.sent.events = nil

	return f
}

// newCustomShipmentServiceWithAccounts is the fixture's service with the restock tests' accounts: 42 active (not
// operational), 43 archived, 44 another team's.
func newCustomShipmentServiceWithAccounts(f *csFixture) *inventory_v1.Service {
	return inventory_v1.NewService(f.db, nil, nil, fakeSuppliers{csSupplierA: true, csSupplierB: true}, f.sent.send, csFacts(),
		nil, restockAccounts(), nil, nil)
}

// csFacts is the transfer fixture's products plus the restocked ones.
func csFacts() fakeFacts {
	facts := wtFacts()
	facts[csWidget] = inventory_v1.ProductFact{TeamID: otMelati, ProductCode: "WG-1", Name: "Widget"}
	facts[csGadget] = inventory_v1.ProductFact{TeamID: otMelati, ProductCode: "GD-1", Name: "Gadget"}
	facts[csGizmo] = inventory_v1.ProductFact{TeamID: otMelati, ProductCode: "GZ-1", Name: "Gizmo"}
	facts[csSinarWidget] = inventory_v1.ProductFact{TeamID: otSinar, ProductCode: "SW-1", Name: "Sinar Widget"}

	return facts
}

func csRestock(t *testing.T, svc *inventory_v1.Service, team uint64, items ...*inventoryv1.RestockRequestItem) *inventoryv1.RestockRequest {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: wtA, Items: items,
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	return created.Msg.GetRequest()
}

func csProduct(product uint64, quantity uint64) *inventoryv1.CustomShipmentLine {
	return &inventoryv1.CustomShipmentLine{ProductId: product, Quantity: quantity}
}

func csRestockLine(restockItem uint64, quantity uint64) *inventoryv1.CustomShipmentLine {
	return &inventoryv1.CustomShipmentLine{RestockItemId: restockItem, Quantity: quantity}
}

// csSample is Melati's sample from A to Budi, the team paying Rp 15.000 from account 77.
func csSample(key string, lines ...*inventoryv1.CustomShipmentLine) *inventoryv1.CustomShipmentCreateRequest {
	return &inventoryv1.CustomShipmentCreateRequest{
		TeamId: otMelati, Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE, WarehouseId: wtA, Lines: lines,
		Recipient:         &inventoryv1.CustomShipmentRecipient{Name: "Budi", Phone: "0812-1111", Address: "Jl. Mawar 1, Bandung"},
		ShipmentChannelId: csCourier,
		Payer:             inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM,
		FinanceAccountId:  wtAccount,
		ShippingCost:      15000,
		Note:              "sample for Budi",
		IdempotencyKey:    key,
	}
}

// csReship is Melati's reship of its received restock back to supplier 31, the warehouse paying at the handover.
func (f *csFixture) csReship(key string, lines ...*inventoryv1.CustomShipmentLine) *inventoryv1.CustomShipmentCreateRequest {
	return &inventoryv1.CustomShipmentCreateRequest{
		TeamId: otMelati, Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP, RestockId: f.restock,
		Lines:             lines,
		Recipient:         &inventoryv1.CustomShipmentRecipient{Name: "Toko Sumber", Phone: "0813-2222", Address: "Pasar Baru 7"},
		ShipmentChannelId: csCourier,
		Payer:             inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE,
		IdempotencyKey:    key,
	}
}

func (f *csFixture) create(req *inventoryv1.CustomShipmentCreateRequest) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentCreate(ctxUser(wtSeller), connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

func (f *csFixture) mustCreate(t *testing.T, req *inventoryv1.CustomShipmentCreateRequest) *inventoryv1.CustomShipment {
	t.Helper()

	cs, err := f.create(req)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return cs
}

func (f *csFixture) detail(teamID, id uint64) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentDetail(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentDetailRequest{
		TeamId: teamID, Id: id,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

// customShipmentEvents is what the custom shipment published, in order.
func (f *csFixture) customShipmentEvents() []*eventsv1.Event {
	var out []*eventsv1.Event

	for _, e := range f.sent.events {
		switch e.GetMessage().(type) {
		case *eventsv1.Event_CustomShipmentCreated, *eventsv1.Event_CustomShipmentCostUpdated,
			*eventsv1.Event_CustomShipmentCancelled, *eventsv1.Event_CustomShipmentHandedOver:
			out = append(out, e)
		}
	}

	return out
}

func csItemOf(t *testing.T, cs *inventoryv1.CustomShipment, product uint64) *inventoryv1.CustomShipmentItem {
	t.Helper()

	for _, item := range cs.GetItems() {
		if item.GetProductId() == product {
			return item
		}
	}

	t.Fatalf("custom shipment %d has no line of product %d", cs.GetId(), product)

	return nil
}

// sellerMoneyFields is the seller's money a custom shipment can carry: the sample's value, a line's value, the team's
// account and the team's courier cost.
var sellerMoneyFields = map[protoreflect.Name]bool{
	"total":              true,
	"finance_account_id": true,
	"shipping_cost":      true,
}

// moneySet walks a message and every message under it and names each seller-money field that is SET — a field left
// unset is absent from what the reader receives, so this is what the data carries, not what a screen draws.
func moneySet(m protoreflect.Message, path string) []string {
	var out []string

	m.Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		name := path + string(fd.Name())

		switch {
		case fd.IsList() && fd.Message() != nil:
			list := v.List()
			for i := range list.Len() {
				out = append(out, moneySet(list.Get(i).Message(), name+"[].")...)
			}
		case fd.Message() != nil && !fd.IsMap():
			out = append(out, moneySet(v.Message(), name+".")...)
		case sellerMoneyFields[fd.Name()]:
			out = append(out, name)
		}

		return true
	})

	return out
}
