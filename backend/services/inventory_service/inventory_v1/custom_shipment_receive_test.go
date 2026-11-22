package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// TERIMA (a-suppliers-reshipping-comes-in-as-a-custom-shipment — 🔄 A a restock box's count, 🔄 B the seller's price,
// 🔄 A the stock-in linked, 🔄 A the restock's door charge): the good units go on the rack named as stock AT THE SELLER'S
// PRICE — the restock's stock-in, its transaction linked in restock_custom_shipments and read back on the row, the parcel
// and the event; the courier's charge is final here, REPLACING Tiba's, and CustomShipmentReceived carries it for Team
// Balance. A whole box reopens nothing: a settled restock stays settled. Counted once.
func TestCustomShipmentReceive_TheGoodUnitsComeInAtTheSellersPrice(t *testing.T) {
	f := rsStocked(t)

	_, err := f.settle(otMelati, f.restock)
	if err != nil {
		t.Fatalf("settle: %v", err)
	}

	cs := f.inbound(t, f.restock, "inbound-whole")
	widget, kaos := csItemOf(t, cs, csWidget).GetId(), csItemOf(t, cs, wtKaosHitam).GetId()
	f.arrive(t, cs.GetId(), 8000, "COD")

	widgetBefore := onHandAt(t, f.db, wtA, csWidget, &f.rakB)
	kaosBefore := onHandAt(t, f.db, wtA, wtKaosHitam, &f.rakB)
	f.sent.events = nil

	got, err := f.receive(cs.GetId(), 6000, "the courier's final ask", inLine(widget, 3, 0, f.rakB), inLine(kaos, 2, 0, f.rakB))
	if err != nil {
		t.Fatalf("receive: %v", err)
	}

	if got.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_RECEIVED || got.GetReceivedByUserId() != wtStaffA ||
		got.GetShippingCost() != 6000 || got.GetChargeNote() != "the courier's final ask" || got.GetTransactionId() == 0 {
		t.Fatalf("received = %v", got)
	}

	if w := csItemOf(t, got, csWidget); w.GetReceived() != 3 || w.GetBroken() != 0 || w.GetRackId() != f.rakB || w.PriceUnit != nil {
		t.Fatalf("the warehouse's Widget line = %v", w)
	}

	if d := onHandAt(t, f.db, wtA, csWidget, &f.rakB) - widgetBefore; d != 3 {
		t.Fatalf("Widget on Rak B moved %d, want 3", d)
	}

	if d := onHandAt(t, f.db, wtA, wtKaosHitam, &f.rakB) - kaosBefore; d != 2 {
		t.Fatalf("Kaos Hitam on Rak B moved %d, want 2", d)
	}

	// The batches the stock-in minted carry the seller's typed price — never a landed one — and the parcel's supplier.
	var batches []struct {
		ProductID uint64
		PriceUnit float64
		TeamID    uint64
	}

	err = f.db.Raw(`SELECT product_id, price_unit, team_id FROM batches WHERE transaction_id = ? ORDER BY product_id`,
		got.GetTransactionId()).Scan(&batches).Error
	if err != nil {
		t.Fatalf("read batches: %v", err)
	}

	prices := map[uint64]float64{}
	for _, b := range batches {
		prices[b.ProductID] = b.PriceUnit

		if b.TeamID != otMelati {
			t.Fatalf("a batch owned by %d, want the selling team", b.TeamID)
		}
	}

	if len(batches) != 2 || prices[csWidget] != 9000 || prices[wtKaosHitam] != 5000 {
		t.Fatalf("batches = %+v, want Widget at 9.000 and Kaos Hitam at 5.000", batches)
	}

	// The link — the row reads the stock-in too.
	rows := f.restockAs(t, otMelati, wtSeller, f.restock).GetResolutions()
	if len(rows) != 1 || rows[0].GetInventoryTransactionId() != got.GetTransactionId() {
		t.Fatalf("the reshipping row reads %v", rows)
	}

	events := receivedEvents(f)
	if len(events) != 1 {
		t.Fatalf("published %d CustomShipmentReceived", len(events))
	}

	if e := events[0]; e.GetDoorCharge() != 6000 || e.GetTeamId() != otMelati || e.GetWarehouseId() != wtA ||
		e.GetCustomShipmentId() != cs.GetId() || e.GetTransactionId() != got.GetTransactionId() || e.GetActorId() != wtStaffA ||
		e.GetRestockId() != f.restock || e.GetResolutionId() != rows[0].GetId() {
		t.Fatalf("CustomShipmentReceived = %+v", e)
	}

	if id := f.sent.events[len(f.sent.events)-1].GetEventId(); id != "custom-shipment-received:"+itoaU(cs.GetId()) {
		t.Fatalf("event id = %q", id)
	}

	// A whole box reopens nothing.
	if after := f.restockAs(t, otMelati, wtSeller, f.restock); after.GetSettledAtUnix() == 0 || len(problemTagsOn(t, f.db, f.restock)) != 0 {
		t.Fatalf("a whole box reopened the restock: settled %d, tags %v", after.GetSettledAtUnix(), problemTagsOn(t, f.db, f.restock))
	}

	_, err = f.receive(cs.GetId(), 0, "", inLine(widget, 3, 0, f.rakB), inLine(kaos, 2, 0, f.rakB))
	codeOf(t, "counted twice", err, connect.CodeFailedPrecondition)
}

// A LATE SHORTFALL REOPENS (a-restock-problem-is-settled-by-resolution-rows, 🔄 A): a settled received restock whose
// reshipping arrives short and broken gets *Barang kurang* and *Barang rusak* back on and its settled mark lifted; a
// settled LOST restock's reshipping arriving short lifts the mark only (it carries no problem tag) — back on the Hilang
// tab. Straight from on its way, the count also stamps who signed for it.
func TestCustomShipmentReceive_AShortOrBrokenCountReopensTheRestock(t *testing.T) {
	f := rsStocked(t)

	_, err := f.settle(otMelati, f.restock)
	if err != nil {
		t.Fatalf("settle: %v", err)
	}

	cs := f.mustResolve(t, rsReshipping(f.restock, "inbound-short", rsLine(csWidget, 3, 9000))).GetCustomShipment()

	got, err := f.receive(cs.GetId(), 0, "", inLine(csItemOf(t, cs, csWidget).GetId(), 2, 1, f.rakA))
	if err != nil {
		t.Fatalf("receive: %v", err)
	}

	if got.GetArrivedByUserId() != wtStaffA || got.GetArrivedAtUnix() == 0 {
		t.Fatalf("counted straight from on its way, nobody signed: %v", got)
	}

	if after := f.restockAs(t, otMelati, wtSeller, f.restock); after.GetSettledAtUnix() != 0 || after.GetSettledByUserId() != 0 {
		t.Fatalf("still settled after a short count: %d", after.GetSettledAtUnix())
	}

	if tags := problemTagsOn(t, f.db, f.restock); !slices.Equal(tags, []string{"restock.problem.broken", "restock.problem.missing"}) {
		t.Fatalf("tags = %v, want both problem tags back on", tags)
	}

	// The lost restock's turn.
	lost := f.lostRestock(t)

	_, err = f.settle(otMelati, lost)
	if err != nil {
		t.Fatalf("settle the lost one: %v", err)
	}

	in := f.mustResolve(t, rsReshipping(lost, "lost-inbound", rsLine(csWidget, 4, 10000))).GetCustomShipment()

	_, err = f.receive(in.GetId(), 0, "", inLine(csItemOf(t, in, csWidget).GetId(), 3, 0, f.rakA))
	if err != nil {
		t.Fatalf("receive the lost one's: %v", err)
	}

	if after := f.restockAs(t, otMelati, wtSeller, lost); after.GetSettledAtUnix() != 0 ||
		after.GetStatus() != inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST {
		t.Fatalf("the lost restock after a short count: settled %d, %s", after.GetSettledAtUnix(), after.GetStatus())
	}

	if tags := problemTagsOn(t, f.db, lost); len(tags) != 0 {
		t.Fatalf("a lost restock got problem tags: %v", tags)
	}
}

// Terima's count is checked against the parcel: every line once, at most what the line says, broken at most received,
// good units on a rack of THIS warehouse (another's reads NotFound) — and nothing is written by a refused count. The
// selling team never counts.
func TestCustomShipmentReceive_RefusesAMalformedCount(t *testing.T) {
	f := rsStocked(t)
	cs := f.inbound(t, f.restock, "inbound-bad")
	widget, kaos := csItemOf(t, cs, csWidget).GetId(), csItemOf(t, cs, wtKaosHitam).GetId()

	cases := []struct {
		what  string
		lines []*inventoryv1.CustomShipmentReceivedLine
		code  connect.Code
	}{
		{"a line left out", []*inventoryv1.CustomShipmentReceivedLine{inLine(widget, 3, 0, f.rakA)}, connect.CodeInvalidArgument},
		{"more than the line says", []*inventoryv1.CustomShipmentReceivedLine{inLine(widget, 4, 0, f.rakA), inLine(kaos, 2, 0, f.rakA)}, connect.CodeInvalidArgument},
		{"broken over received", []*inventoryv1.CustomShipmentReceivedLine{inLine(widget, 1, 2, f.rakA), inLine(kaos, 2, 0, f.rakA)}, connect.CodeInvalidArgument},
		{"good units on no rack", []*inventoryv1.CustomShipmentReceivedLine{inLine(widget, 3, 0, 0), inLine(kaos, 2, 0, f.rakA)}, connect.CodeInvalidArgument},
		{"a line twice", []*inventoryv1.CustomShipmentReceivedLine{inLine(widget, 3, 0, f.rakA), inLine(widget, 3, 0, f.rakA)}, connect.CodeInvalidArgument},
		{"another warehouse's rack", []*inventoryv1.CustomShipmentReceivedLine{inLine(widget, 3, 0, f.rakB1), inLine(kaos, 2, 0, f.rakA)}, connect.CodeNotFound},
	}

	for _, c := range cases {
		_, err := f.receive(cs.GetId(), 0, "", c.lines...)
		codeOf(t, c.what, err, c.code)
	}

	_, err := f.svc.CustomShipmentReceive(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentReceiveRequest{
		TeamId: otMelati, Id: cs.GetId(), Lines: []*inventoryv1.CustomShipmentReceivedLine{inLine(widget, 3, 0, f.rakA)},
	}))
	codeOf(t, "the selling team counting", err, connect.CodeNotFound)

	// All good units broken: no stock-in at all, nothing linked — a count with nothing to shelve needs no rack.
	got, err := f.receive(cs.GetId(), 0, "", inLine(widget, 3, 3, 0), inLine(kaos, 0, 0, 0))
	if err != nil {
		t.Fatalf("an all-broken count: %v", err)
	}

	if got.GetTransactionId() != 0 || csItemOf(t, got, wtKaosHitam).GetReceived() != 0 {
		t.Fatalf("an all-broken count = %v", got)
	}

	if tags := problemTagsOn(t, f.db, f.restock); !slices.Equal(tags, []string{"restock.problem.broken", "restock.problem.missing"}) {
		t.Fatalf("an all-broken, short count: tags = %v", tags)
	}
}

// The lists (the-restock-resolutions-prototype-is-accepted): the seller's Kirim Paket lists inbound parcels under Semua
// and by their kind; the warehouse's queue keeps to what it ships, and its incoming list asks INBOUND; every row names
// its resolution; the warehouse's rows carry no seller price.
func TestCustomShipmentList_TheInboundParcels(t *testing.T) {
	f := rsStocked(t)
	in := f.inbound(t, f.restock, "list-in")
	out := f.mustCreate(t, f.csReship("list-out", csRestockLine(f.line[csWidget], 1)))

	list := func(team, user uint64, filter *inventoryv1.CustomShipmentListFilter) []*inventoryv1.CustomShipment {
		t.Helper()

		res, err := f.svc.CustomShipmentList(ctxUser(user), connect.NewRequest(&inventoryv1.CustomShipmentListRequest{
			TeamId: team, Filter: filter, Page: rsPage(),
		}))
		if err != nil {
			t.Fatalf("list: %v", err)
		}

		return res.Msg.GetCustomShipments()
	}

	if ids := rsIDs(list(otMelati, wtSeller, nil)); !slices.Contains(ids, in.GetId()) || !slices.Contains(ids, out.GetId()) {
		t.Fatalf("the seller's Semua = %v", ids)
	}

	inbound := inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_INBOUND

	if ids := rsIDs(list(wtA, wtStaffA, nil)); slices.Contains(ids, in.GetId()) || !slices.Contains(ids, out.GetId()) {
		t.Fatalf("the warehouse's queue = %v, want only what it ships", ids)
	}

	rows := list(wtA, wtStaffA, &inventoryv1.CustomShipmentListFilter{
		Direction: inbound, Status: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_ON_THE_WAY,
	})
	if len(rows) != 1 || rows[0].GetId() != in.GetId() || rows[0].GetResolutionId() == 0 {
		t.Fatalf("the warehouse's incoming = %v", rsIDs(rows))
	}

	if set := inboundMoneySet(rows[0].ProtoReflect(), ""); len(set) != 0 {
		t.Fatalf("the warehouse's row carries seller money: %v", set)
	}

	byKind := list(otMelati, wtSeller, &inventoryv1.CustomShipmentListFilter{
		Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SUPPLIER_RESHIPPING,
	})
	if len(byKind) != 1 || byKind[0].GetId() != in.GetId() || csItemOf(t, byKind[0], csWidget).GetPriceUnit() != 9000 {
		t.Fatalf("the seller's inbound kind = %v", rsIDs(byKind))
	}

	outbound := list(otMelati, wtSeller, &inventoryv1.CustomShipmentListFilter{
		Direction: inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_OUTBOUND,
	})
	if ids := rsIDs(outbound); slices.Contains(ids, in.GetId()) || !slices.Contains(ids, out.GetId()) {
		t.Fatalf("the seller's outbound = %v", ids)
	}
}
