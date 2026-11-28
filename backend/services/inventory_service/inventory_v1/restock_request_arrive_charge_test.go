package inventory_v1_test

import (
	"math"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE COURIER'S CHARGE IS NOTED AT TIBA AND FINAL AT TERIMA (the-courier-charge-is-noted-at-tiba-and-final-at-terima): the
// warehouse may note the courier's charge — its amount, its note, the photo of its slip — as it signs for the box, under
// Terima's rules. Tiba's is kept on the restock and read back; Terima opens with it and its figure is FINAL, replacing
// Tiba's, never adding to it (the-courier-is-paid-once-per-restock). The money — the selling team owing the warehouse —
// moves only at Terima, from *Restock Accepted*: a sign publishes nothing, and a box signed for is never lost or
// cancelled after.
//
// The restocks are arrRaise's: selling team 2 → warehouse 5, Kaos 10 × Rp 100.000 + Celana 5 × Rp 150.000, freight
// Rp 20.000 — 15 units ordered.

const (
	tibaSlip   = "doc-slip-at-tiba"
	terimaSlip = "doc-slip-at-terima"
	tibaNote   = "biaya COD"
	terimaNote = "biaya COD + bongkar"
)

// tibaService is arrService with what these tests watch: what is published (the money's only door), what reaches the
// liability port, and document_service's signer over the warehouse's two slips.
func tibaService(db *gorm.DB) (*inventory_v1.Service, *recordingSender, *recordingPoster) {
	sender := &recordingSender{}
	poster := &recordingPoster{}
	linker := &fakePhotoLinker{owners: map[string]uint64{tibaSlip: arrWarehouse, terimaSlip: arrWarehouse}}

	svc := inventory_v1.NewService(db, poster, nil, fakeSuppliers{arrMelati: true, arrSinar: true}, sender.send, nil, linker,
		nil, nil, nil)

	return svc, sender, poster
}

// signWithCharge signs for the box noting the courier's charge, its note and its slip.
func signWithCharge(
	svc *inventory_v1.Service,
	requestID uint64,
	charge float64,
	note, slip string,
) (*inventoryv1.RestockRequest, error) {
	resp, err := svc.RestockRequestArrive(ctxUser(arrSigner), connect.NewRequest(&inventoryv1.RestockRequestArriveRequest{
		TeamId: arrWarehouse, RequestId: requestID,
		WarehouseAdditionalCost: charge, WarehouseAdditionalCostNote: note, WarehouseAdditionalCostFile: slip,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetRequest(), nil
}

// acceptWithCharge counts the box in whole, with the charge, note and slip in Terima's form.
func acceptWithCharge(
	t *testing.T,
	db *gorm.DB,
	svc *inventory_v1.Service,
	raised *inventoryv1.RestockRequest,
	charge float64,
	note, slip string,
) error {
	t.Helper()

	_, err := svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: arrWarehouse, RequestId: raised.GetId(), Lines: allArrived(t, db, raised),
		WarehouseAdditionalCost: charge, WarehouseAdditionalCostNote: note, WarehouseAdditionalCostFile: slip,
	}))

	return err
}

// acceptedEvents is every *Restock Accepted* published — the one event the selling team's debt is posted from.
func acceptedEvents(sender *recordingSender) []*eventsv1.RestockAccepted {
	var out []*eventsv1.RestockAccepted

	for _, event := range sender.sent {
		if a := event.GetRestockAccepted(); a != nil {
			out = append(out, a)
		}
	}

	return out
}

// TIBA KEEPS IT: the answer, the stored row and both sides' Detail carry the charge, its note and its slip — and both
// detail pages open the slip (RestockDoorPhotos), as they open Terima's. The box is arrived, its stock unmoved.
func TestRestockRequestArrive_KeepsTheChargeNotedAtTheDoor(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _, _ := tibaService(db)

	raised := arrRaise(t, svc)

	signed, err := signWithCharge(svc, raised.GetId(), 15000, tibaNote, tibaSlip)
	if err != nil {
		t.Fatalf("arrive with a charge: %v", err)
	}

	if signed.GetStatus() != statusArrived || signed.GetWarehouseAdditionalCost() != 15000 ||
		signed.GetWarehouseAdditionalCostNote() != tibaNote || signed.GetWarehouseAdditionalCostFile() != tibaSlip {
		t.Fatalf("the sign answers %v with %v %q %q — want arrived with 15000 %q %q", signed.GetStatus(),
			signed.GetWarehouseAdditionalCost(), signed.GetWarehouseAdditionalCostNote(),
			signed.GetWarehouseAdditionalCostFile(), tibaNote, tibaSlip)
	}

	stored := storedSlip(t, db, raised.GetId())
	if stored.WarehouseAdditionalCost != 15000 || stored.WarehouseAdditionalCostNote != tibaNote ||
		stored.WarehouseAdditionalCostFile != tibaSlip {
		t.Fatalf("stored %v %q %q — want 15000 %q %q in the columns Terima writes", stored.WarehouseAdditionalCost,
			stored.WarehouseAdditionalCostNote, stored.WarehouseAdditionalCostFile, tibaNote, tibaSlip)
	}

	// The selling team reads it on its own page…
	selling := arrDetail(t, svc, raised.GetId())
	if selling.GetWarehouseAdditionalCost() != 15000 || selling.GetWarehouseAdditionalCostNote() != tibaNote {
		t.Fatalf("the selling team reads %v %q, want 15000 %q", selling.GetWarehouseAdditionalCost(),
			selling.GetWarehouseAdditionalCostNote(), tibaNote)
	}

	// …and both sides open the slip, signed for the warehouse that uploaded it.
	for _, team := range []uint64{arrSellingTeam, arrWarehouse} {
		photos, photoErr := doorPhotos(svc, team, raised.GetId())
		if photoErr != nil {
			t.Fatalf("door photos as team %d: %v", team, photoErr)
		}

		if photos.GetCourierSlipUrl() != "https://files.invalid/"+tibaSlip {
			t.Fatalf("team %d opens the slip at %q, want Tiba's", team, photos.GetCourierSlipUrl())
		}
	}

	// Signing moves no stock — the charge noted is no batch, no price.
	var batches int64

	err = db.Table("batches").Where("warehouse_id = ? AND product_id IN ?", arrWarehouse, []uint64{100, 200}).Count(&batches).Error
	if err != nil {
		t.Fatal(err)
	}

	if batches != 0 {
		t.Fatalf("%d batches after a sign, want none — the box is not counted yet", batches)
	}
}

// VALIDATION AS TERIMA'S: a charge with no note is kept and the box set arrived (the-couriers-charge-note-is-optional —
// inverted from "refused, nothing signed"); a negative or non-finite one is the contract's to refuse; a slip with no
// charge is dropped. A Set Arrived with nothing noted keeps nothing.
func TestRestockRequestArrive_TheChargeFollowsTerimasRules(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _, _ := tibaService(db)

	noNote := arrRaise(t, svc)

	_, err := signWithCharge(svc, noNote.GetId(), 15000, "", tibaSlip)
	if err != nil {
		t.Fatalf("a charge without its note = %v, want it kept — the note is optional", err)
	}

	if got := arrDetail(t, svc, noNote.GetId()); got.GetStatus() != statusArrived || got.GetWarehouseAdditionalCost() != 15000 ||
		got.GetWarehouseAdditionalCostNote() != "" || got.GetWarehouseAdditionalCostFile() != tibaSlip {
		t.Fatalf("after a charge with no note: %v with charge %v %q, slip %q — want arrived with 15000, no note, its slip",
			got.GetStatus(), got.GetWarehouseAdditionalCost(), got.GetWarehouseAdditionalCostNote(),
			got.GetWarehouseAdditionalCostFile())
	}

	// The contract refuses what the handler never sees — as on Accept.
	for _, bad := range []float64{-5000, math.Inf(1), math.NaN()} {
		valErr := protovalidate.Validate(&inventoryv1.RestockRequestArriveRequest{
			TeamId: arrWarehouse, RequestId: noNote.GetId(), WarehouseAdditionalCost: bad, WarehouseAdditionalCostNote: tibaNote,
		})
		if valErr == nil {
			t.Fatalf("a charge of %v passed validation, want refused", bad)
		}
	}

	// A slip with no charge (Tidak ada) is not kept — the slip belongs to the charge.
	slipOnly := arrRaise(t, svc)

	_, err = signWithCharge(svc, slipOnly.GetId(), 0, "", tibaSlip)
	if err != nil {
		t.Fatalf("arrive with a slip and no charge: %v", err)
	}

	if rr := storedSlip(t, db, slipOnly.GetId()); rr.WarehouseAdditionalCost != 0 || rr.WarehouseAdditionalCostFile != "" {
		t.Fatalf("charge %v, slip %q — want no charge and no slip", rr.WarehouseAdditionalCost, rr.WarehouseAdditionalCostFile)
	}

	// The plain sign — nothing noted — keeps nothing, as before.
	plain := arrRaise(t, svc)

	_, err = arrSign(svc, arrWarehouse, plain.GetId())
	if err != nil {
		t.Fatalf("plain arrive: %v", err)
	}

	if rr := storedSlip(t, db, plain.GetId()); rr.WarehouseAdditionalCost != 0 || rr.WarehouseAdditionalCostNote != "" ||
		rr.WarehouseAdditionalCostFile != "" {
		t.Fatalf("a plain sign stored %v %q %q, want nothing", rr.WarehouseAdditionalCost, rr.WarehouseAdditionalCostNote,
			rr.WarehouseAdditionalCostFile)
	}
}

// NO MONEY AT TIBA, AND NONE FROM A BOX SIGNED FOR AND THEN GIVEN UP: the sign publishes nothing and asks the liability
// port nothing; giving the box up as lost or cancelling it once signed for is refused (both are ongoing-only), so a
// noted charge has no way to money but Terima — and the refusals publish nothing either. The charge stays noted.
func TestRestockRequestArrive_MovesNoMoney(t *testing.T) {
	db := san_testdb.DB(t)
	svc, sender, poster := tibaService(db)

	raised := arrRaise(t, svc)
	created := len(sender.sent)

	_, err := signWithCharge(svc, raised.GetId(), 15000, tibaNote, tibaSlip)
	if err != nil {
		t.Fatalf("arrive with a charge: %v", err)
	}

	_, err = svc.RestockRequestMarkLost(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
		TeamId: arrSellingTeam, RequestId: raised.GetId(),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("giving up a box signed for = %v, want FailedPrecondition", err)
	}

	_, err = svc.RestockRequestCancel(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: arrSellingTeam, RequestId: raised.GetId(), MoneyReturned: true,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("cancelling a box signed for = %v, want FailedPrecondition", err)
	}

	if after := sender.sent[created:]; len(after) != 0 {
		t.Fatalf("the sign and the refusals published %v — want nothing: the debt is Terima's alone", after)
	}

	if len(poster.damaged) != 0 {
		t.Fatalf("the liability port was asked %+v, want nothing", poster.damaged)
	}

	if got := arrDetail(t, svc, raised.GetId()); got.GetStatus() != statusArrived || got.GetWarehouseAdditionalCost() != 15000 {
		t.Fatalf("after the refusals: %v with charge %v, want still arrived with Tiba's 15000", got.GetStatus(),
			got.GetWarehouseAdditionalCost())
	}
}

// TERIMA'S FIGURE IS FINAL AND REPLACES TIBA'S: a charge changed at Terima is the one stored — its note and slip too —
// the one *Restock Accepted* carries ONCE (what balance posts the debt from), and the one in the landed price. Never
// Tiba's, never the two added.
func TestRestockRequestAccept_TerimasFigureReplacesTibas(t *testing.T) {
	db := san_testdb.DB(t)
	svc, sender, _ := tibaService(db)

	raised := arrRaise(t, svc)

	_, err := signWithCharge(svc, raised.GetId(), 15000, tibaNote, tibaSlip)
	if err != nil {
		t.Fatalf("arrive with a charge: %v", err)
	}

	err = acceptWithCharge(t, db, svc, raised, 30000, terimaNote, terimaSlip)
	if err != nil {
		t.Fatalf("accept with a changed charge: %v", err)
	}

	stored := storedSlip(t, db, raised.GetId())
	if stored.WarehouseAdditionalCost != 30000 || stored.WarehouseAdditionalCostNote != terimaNote ||
		stored.WarehouseAdditionalCostFile != terimaSlip {
		t.Fatalf("stored %v %q %q — want Terima's 30000 %q %q", stored.WarehouseAdditionalCost,
			stored.WarehouseAdditionalCostNote, stored.WarehouseAdditionalCostFile, terimaNote, terimaSlip)
	}

	events := acceptedEvents(sender)
	if len(events) != 1 || events[0].GetWarehouseAdditionalCost() != 30000 || events[0].GetWarehouseAdditionalCostNote() != terimaNote {
		t.Fatalf("Restock Accepted = %v — want ONE carrying Terima's 30000 %q", events, terimaNote)
	}

	// The landed price carries Terima's charge: (20.000 freight + 30.000) over the 15 units ordered.
	var price float64

	err = db.Table("batches").Select("price_unit").Where("warehouse_id = ? AND product_id = ?", arrWarehouse, 100).Scan(&price).Error
	if err != nil {
		t.Fatal(err)
	}

	if want := inventory_mutations.LandedPrice(100000, 10, 20000+30000, 15); math.Abs(price-want) > 1e-6 {
		t.Fatalf("Kaos's batch price = %v, want %v — the freight with Terima's charge alone", price, want)
	}
}

// A CHARGE WITH NO NOTE GOES ALL THE WAY (the-couriers-charge-note-is-optional): noted at Set Arrived with no note, Terima
// opens with it and sends it untouched — still with no note — and *Restock Accepted* carries it, so the selling team owes
// the amount as it would with a note; the note travels empty.
func TestRestockRequestAccept_TibasChargeWithNoNoteIsPosted(t *testing.T) {
	db := san_testdb.DB(t)
	svc, sender, _ := tibaService(db)

	raised := arrRaise(t, svc)

	_, err := signWithCharge(svc, raised.GetId(), 15000, "", "")
	if err != nil {
		t.Fatalf("arrive with a charge and no note: %v", err)
	}

	err = acceptWithCharge(t, db, svc, raised, 15000, "", "")
	if err != nil {
		t.Fatalf("accept with a charge and no note = %v, want it accepted", err)
	}

	if rr := storedRestock(t, db, raised.GetId()); rr.Status != "accepted" || rr.WarehouseAdditionalCost != 15000 ||
		rr.WarehouseAdditionalCostNote != "" {
		t.Fatalf("stored %q with %v %q — want accepted with 15000 and no note", rr.Status, rr.WarehouseAdditionalCost,
			rr.WarehouseAdditionalCostNote)
	}

	events := acceptedEvents(sender)
	if len(events) != 1 || events[0].GetWarehouseAdditionalCost() != 15000 || events[0].GetWarehouseAdditionalCostNote() != "" {
		t.Fatalf("Restock Accepted = %v, want one carrying 15000 with no note", events)
	}
}

// …and Terima opening with Tiba's and sending it UNTOUCHED posts it once — not twice; and Terima switched to Tidak ada
// leaves no charge at all, Tiba's included: its figure is final.
func TestRestockRequestAccept_TibasChargeIsPostedOnceOrDropped(t *testing.T) {
	db := san_testdb.DB(t)
	svc, sender, _ := tibaService(db)

	kept := arrRaise(t, svc)

	_, err := signWithCharge(svc, kept.GetId(), 15000, tibaNote, tibaSlip)
	if err != nil {
		t.Fatalf("arrive with a charge: %v", err)
	}

	// The accept page sends what it opened with.
	err = acceptWithCharge(t, db, svc, kept, 15000, tibaNote, tibaSlip)
	if err != nil {
		t.Fatalf("accept with Tiba's charge: %v", err)
	}

	if rr := storedSlip(t, db, kept.GetId()); rr.WarehouseAdditionalCost != 15000 || rr.WarehouseAdditionalCostFile != tibaSlip {
		t.Fatalf("stored %v %q — want Tiba's 15000 and its slip, once", rr.WarehouseAdditionalCost, rr.WarehouseAdditionalCostFile)
	}

	dropped := arrRaise(t, svc)

	_, err = signWithCharge(svc, dropped.GetId(), 15000, tibaNote, tibaSlip)
	if err != nil {
		t.Fatalf("arrive with a charge: %v", err)
	}

	// Terima says there was none after all.
	err = acceptWithCharge(t, db, svc, dropped, 0, "", "")
	if err != nil {
		t.Fatalf("accept with no charge: %v", err)
	}

	if rr := storedSlip(t, db, dropped.GetId()); rr.WarehouseAdditionalCost != 0 || rr.WarehouseAdditionalCostNote != "" ||
		rr.WarehouseAdditionalCostFile != "" {
		t.Fatalf("stored %v %q %q — want nothing: Terima's none replaces Tiba's", rr.WarehouseAdditionalCost,
			rr.WarehouseAdditionalCostNote, rr.WarehouseAdditionalCostFile)
	}

	charges := map[uint64]float64{}
	for _, a := range acceptedEvents(sender) {
		if _, twice := charges[a.GetRestockId()]; twice {
			t.Fatalf("restock %d accepted twice in the events", a.GetRestockId())
		}

		charges[a.GetRestockId()] = a.GetWarehouseAdditionalCost()
	}

	if len(charges) != 2 || charges[kept.GetId()] != 15000 || charges[dropped.GetId()] != 0 {
		t.Fatalf("Restock Accepted charges = %v — want %d: 15000 and %d: 0", charges, kept.GetId(), dropped.GetId())
	}
}

// A LATE LOST BOX IS SIGNED FOR AS ARRIVED (a-late-lost-box-is-signed-for-as-arrived) — and takes the charge the same way:
// kept beside the trail's lost → arrived, then final at Terima, posted once.
func TestRestockRequestArrive_ALateLostBoxTakesTheCharge(t *testing.T) {
	db := san_testdb.DB(t)
	svc, sender, _ := tibaService(db)

	raised := arrRaise(t, svc)

	_, err := svc.RestockRequestMarkLost(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
		TeamId: arrSellingTeam, RequestId: raised.GetId(),
	}))
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	signed, err := signWithCharge(svc, raised.GetId(), 12500, tibaNote, tibaSlip)
	if err != nil {
		t.Fatalf("arrive a lost box with a charge: %v", err)
	}

	if signed.GetStatus() != statusArrived || signed.GetWarehouseAdditionalCost() != 12500 ||
		signed.GetWarehouseAdditionalCostFile() != tibaSlip || signed.GetLostByUserId() != arrBuyer {
		t.Fatalf("signed = %v, charge %v, slip %q, lost by %d — want arrived with 12500 and its slip, still lost by %d",
			signed.GetStatus(), signed.GetWarehouseAdditionalCost(), signed.GetWarehouseAdditionalCostFile(),
			signed.GetLostByUserId(), arrBuyer)
	}

	steps := trail(arrDetail(t, svc, raised.GetId()))
	if last := steps[len(steps)-1]; last != (trailStep{statusLost, statusArrived, "set arrived"}) {
		t.Fatalf("the trail ends %v, want lost → arrived", last)
	}

	err = acceptWithCharge(t, db, svc, raised, 12500, tibaNote, tibaSlip)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if events := acceptedEvents(sender); len(events) != 1 || events[0].GetWarehouseAdditionalCost() != 12500 {
		t.Fatalf("Restock Accepted = %v, want one carrying 12500", events)
	}
}

// A CHARGE NOTED ON A COUNTED BOX IS REFUSED, as Arrive refuses any sign there: Terima's figure stays final.
func TestRestockRequestArrive_RefusesAChargeOnACountedBox(t *testing.T) {
	db := san_testdb.DB(t)
	svc, sender, _ := tibaService(db)

	raised := arrRaise(t, svc)

	err := acceptWithCharge(t, db, svc, raised, 5000, terimaNote, terimaSlip)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	published := len(sender.sent)

	_, err = signWithCharge(svc, raised.GetId(), 9000, tibaNote, tibaSlip)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a charge noted on an accepted restock = %v, want FailedPrecondition", err)
	}

	if rr := storedSlip(t, db, raised.GetId()); rr.WarehouseAdditionalCost != 5000 || rr.WarehouseAdditionalCostNote != terimaNote ||
		rr.WarehouseAdditionalCostFile != terimaSlip {
		t.Fatalf("stored %v %q %q — want Terima's 5000 untouched", rr.WarehouseAdditionalCost, rr.WarehouseAdditionalCostNote,
			rr.WarehouseAdditionalCostFile)
	}

	if len(sender.sent) != published {
		t.Fatalf("the refused sign published %v", sender.sent[published:])
	}
}
