package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// THE INBOUND PARCEL'S ACTS BEFORE TERIMA (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A — a restock box's
// steps; 🔄 A — the price editable until Terima): the selling team edits the resi until Tiba and the prices until Terima
// (a price edit's words are its own, blank for the warehouse), and gives the parcel up only while it is on its way. None
// of it works on an outbound parcel, and the other side's team reads NotFound.
func TestCustomShipmentInbound_TheSellersEditsAndGivingItUp(t *testing.T) {
	f := rsStocked(t)
	cs := f.inbound(t, f.restock, "inbound-1")
	widget := csItemOf(t, cs, csWidget).GetId()

	resi, err := f.svc.CustomShipmentResiSet(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentResiSetRequest{
		TeamId: otMelati, Id: cs.GetId(), Resi: " JNE-2 ",
	}))
	if err != nil {
		t.Fatalf("resi: %v", err)
	}

	if got := resi.Msg.GetCustomShipment(); got.GetResi() != "JNE-2" || lastLog(got).GetKind() != inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_RESI_EDIT ||
		lastLog(got).GetDescription() != "JNE-1 → JNE-2" {
		t.Fatalf("after the resi: %v / %v", got.GetResi(), lastLog(got))
	}

	priced := f.prices(t, otMelati, cs.GetId(), widget, 9500)
	if w := csItemOf(t, priced, csWidget); w.GetPriceUnit() != 9500 || w.GetTotal() != 28500 || priced.GetTotal() != 38500 {
		t.Fatalf("after the price: line %v, parcel %v", w, priced.GetTotal())
	}

	if l := lastLog(priced); l.GetKind() != inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_PRICE_EDIT ||
		l.GetDescription() != "WG-1 Rp 9.000 → Rp 9.500" {
		t.Fatalf("price edit row = %v", l)
	}

	// The warehouse reads that the prices changed, never the figures; the resi edit is no money and reads whole.
	seen, err := f.detail(wtA, cs.GetId())
	if err != nil {
		t.Fatalf("warehouse detail: %v", err)
	}

	if l := lastLog(seen); l.GetDescription() != "" || csItemOf(t, seen, csWidget).PriceUnit != nil {
		t.Fatalf("the warehouse reads the price edit: %v", l)
	}

	if set := inboundMoneySet(seen.ProtoReflect(), ""); len(set) != 0 {
		t.Fatalf("the warehouse receives seller money: %v", set)
	}

	_, err = f.svc.CustomShipmentPricesSet(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentPricesSetRequest{
		TeamId: otMelati, Id: cs.GetId(), Lines: []*inventoryv1.CustomShipmentLinePrice{{ItemId: 999999, PriceUnit: 1}},
	}))
	codeOf(t, "a line not the parcel's", err, connect.CodeInvalidArgument)

	_, err = f.svc.CustomShipmentResiSet(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentResiSetRequest{
		TeamId: wtA, Id: cs.GetId(), Resi: "x",
	}))
	codeOf(t, "the warehouse editing the resi", err, connect.CodeNotFound)

	// Tiba: the resi is closed, the prices are not, and it can no longer be given up.
	f.arrive(t, cs.GetId(), 0, "")

	_, err = f.svc.CustomShipmentResiSet(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentResiSetRequest{
		TeamId: otMelati, Id: cs.GetId(), Resi: "late",
	}))
	codeOf(t, "a resi after Tiba", err, connect.CodeFailedPrecondition)

	if w := csItemOf(t, f.prices(t, otMelati, cs.GetId(), widget, 8000), csWidget); w.GetPriceUnit() != 8000 {
		t.Fatalf("a price at the door = %v", w.GetPriceUnit())
	}

	_, err = f.markLost(otMelati, cs.GetId())
	codeOf(t, "lost after Tiba", err, connect.CodeFailedPrecondition)

	// An outbound parcel is never moved this way.
	reship := f.mustCreate(t, f.csReship("outbound", csRestockLine(f.line[csWidget], 1)))

	_, err = f.markLost(otMelati, reship.GetId())
	codeOf(t, "an outbound parcel lost", err, connect.CodeFailedPrecondition)
}

// Hilang while on its way (lost-is-set-only-before-the-box-arrives, alike): the seller gives it up with a reason, nothing
// moves; a lost parcel that turns up is set arrived (a-late-lost-box-is-signed-for-as-arrived). Tiba notes the courier's
// charge at the door — its note optional (the-couriers-charge-note-is-optional) — kept and shown to both sides, and
// publishes nothing (no money at Tiba).
func TestCustomShipmentInbound_LostThenSignedForWithTheDoorCharge(t *testing.T) {
	f := rsStocked(t)
	cs := f.inbound(t, f.restock, "inbound-lost")
	f.sent.events = nil

	lost, err := f.markLost(otMelati, cs.GetId())
	if err != nil {
		t.Fatalf("lost: %v", err)
	}

	if lost.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_LOST || lost.GetLostByUserId() != wtSeller ||
		lost.GetLostReason() != "never came" || lost.GetLostAtUnix() == 0 {
		t.Fatalf("lost = %v", lost)
	}

	_, err = f.svc.CustomShipmentArrive(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentArriveRequest{
		TeamId: otMelati, Id: cs.GetId(),
	}))
	codeOf(t, "the selling team signing", err, connect.CodeNotFound)

	_, err = f.svc.CustomShipmentArrive(ctxUser(wtStaffB), connect.NewRequest(&inventoryv1.CustomShipmentArriveRequest{
		TeamId: wtB, Id: cs.GetId(),
	}))
	codeOf(t, "another warehouse signing", err, connect.CodeNotFound)

	arrived := f.arrive(t, cs.GetId(), 8000, "COD asked by the courier")
	if arrived.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_ARRIVED || arrived.GetArrivedByUserId() != wtStaffA ||
		arrived.GetShippingCost() != 8000 || arrived.GetChargeNote() != "COD asked by the courier" {
		t.Fatalf("arrived = %v", arrived)
	}

	// The trail's words for a charge WITH its note are as they always were: the amount, a dash, the note.
	if got := lastLog(arrived).GetDescription(); got != "courier's charge Rp 8.000 — COD asked by the courier" {
		t.Fatalf("Tiba's trail row says %q, want the charge and its note", got)
	}

	seller, err := f.detail(otMelati, cs.GetId())
	if err != nil {
		t.Fatalf("seller detail: %v", err)
	}

	if seller.GetShippingCost() != 8000 || seller.GetChargeNote() == "" {
		t.Fatalf("the seller reads the noted charge as %v", seller.GetShippingCost())
	}

	if len(f.sent.events) != 0 {
		t.Fatalf("lost and Tiba published %v — no money moves before Terima", f.sent.events)
	}

	_, err = f.markLost(otMelati, cs.GetId())
	codeOf(t, "lost again after Tiba", err, connect.CodeFailedPrecondition)
}

// A DOOR CHARGE WITH NO NOTE IS KEPT (the-couriers-charge-note-is-optional — inverted from "a charge without its note
// is refused"): at Tiba the parcel is set arrived with the amount and no note, its trail row naming the amount alone (no
// dangling dash); at Terima the final amount with no note is counted in, and CustomShipmentReceived carries it, so the
// selling team owes it as it would with a note.
func TestCustomShipmentInbound_ADoorChargeWithNoNoteIsKept(t *testing.T) {
	f := rsStocked(t)
	cs := f.inbound(t, f.restock, "inbound-no-note")
	widget, kaos := csItemOf(t, cs, csWidget).GetId(), csItemOf(t, cs, wtKaosHitam).GetId()

	arrived := f.arrive(t, cs.GetId(), 8000, "  ")
	if arrived.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_ARRIVED ||
		arrived.GetShippingCost() != 8000 || arrived.GetChargeNote() != "" {
		t.Fatalf("arrived = %v, want arrived with 8000 and no note", arrived)
	}

	if got := lastLog(arrived).GetDescription(); got != "courier's charge Rp 8.000" {
		t.Fatalf("Tiba's trail row says %q, want the amount alone", got)
	}

	f.sent.events = nil

	got, err := f.receive(cs.GetId(), 6000, "", inLine(widget, 3, 0, f.rakB), inLine(kaos, 2, 0, f.rakB))
	if err != nil {
		t.Fatalf("receive with a charge and no note = %v, want it counted in", err)
	}

	if got.GetStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_RECEIVED || got.GetShippingCost() != 6000 ||
		got.GetChargeNote() != "" {
		t.Fatalf("received = %v, want received with 6000 and no note", got)
	}

	if text := lastLog(got).GetDescription(); text != "received — 0 broken, 0 short; courier's charge Rp 6.000" {
		t.Fatalf("Terima's trail row says %q, want the count and the amount alone", text)
	}

	if events := receivedEvents(f); len(events) != 1 || events[0].GetDoorCharge() != 6000 {
		t.Fatalf("CustomShipmentReceived = %v, want one carrying 6000", events)
	}
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

func lastLog(cs *inventoryv1.CustomShipment) *inventoryv1.CustomShipmentLog {
	logs := cs.GetLogs()
	if len(logs) == 0 {
		return nil
	}

	return logs[len(logs)-1]
}

func (f *csFixture) prices(t *testing.T, team, id, item uint64, price float64) *inventoryv1.CustomShipment {
	t.Helper()

	res, err := f.svc.CustomShipmentPricesSet(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentPricesSetRequest{
		TeamId: team, Id: id, Lines: []*inventoryv1.CustomShipmentLinePrice{{ItemId: item, PriceUnit: price}},
	}))
	if err != nil {
		t.Fatalf("prices: %v", err)
	}

	return res.Msg.GetCustomShipment()
}

func (f *csFixture) markLost(team, id uint64) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentMarkLost(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentMarkLostRequest{
		TeamId: team, Id: id, Reason: "never came",
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

func (f *csFixture) arrive(t *testing.T, id uint64, charge float64, note string) *inventoryv1.CustomShipment {
	t.Helper()

	res, err := f.svc.CustomShipmentArrive(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentArriveRequest{
		TeamId: wtA, Id: id, DoorCharge: charge, DoorChargeNote: note,
	}))
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	return res.Msg.GetCustomShipment()
}

func (f *csFixture) receive(
	id uint64,
	charge float64,
	note string,
	lines ...*inventoryv1.CustomShipmentReceivedLine,
) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentReceive(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentReceiveRequest{
		TeamId: wtA, Id: id, Lines: lines, DoorCharge: charge, DoorChargeNote: note,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

func inLine(item, received, broken, rack uint64) *inventoryv1.CustomShipmentReceivedLine {
	return &inventoryv1.CustomShipmentReceivedLine{ItemId: item, Received: received, Broken: broken, RackId: rack}
}
