package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// *BARANG TIDAK KETEMU* (backlog #88 P6) — the shipping warehouse's goods-missing note on a parcel still Diminta
// (missing-goods-leave-a-note-on-the-custom-shipment, the-goods-missing-prototype-is-accepted,
// the-goods-missing-badge-is-on-both-lists, missing-reship-units-are-not-offered-again).

func (f *csFixture) missingReport(
	team, id uint64,
	note string,
	lines ...*inventoryv1.CustomShipmentMissingLine,
) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentMissingReport(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentMissingReportRequest{
		TeamId: team, Id: id, Lines: lines, Note: note,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

func (f *csFixture) mustReport(
	t *testing.T,
	id uint64,
	note string,
	lines ...*inventoryv1.CustomShipmentMissingLine,
) *inventoryv1.CustomShipment {
	t.Helper()

	cs, err := f.missingReport(wtA, id, note, lines...)
	if err != nil {
		t.Fatalf("goods missing on %d: %v", id, err)
	}

	return cs
}

func missingLine(item, rack, quantity uint64) *inventoryv1.CustomShipmentMissingLine {
	return &inventoryv1.CustomShipmentMissingLine{ItemId: item, RackId: rack, Quantity: quantity}
}

// takeRacks is what a sample's take drew, per rack — the pick page's reading (StockPickLocations) in A.
func (f *csFixture) takeRacks(t *testing.T, cs *inventoryv1.CustomShipment) map[uint64]int64 {
	t.Helper()

	res, err := f.svc.StockPickLocations(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
		WarehouseId: wtA, TransactionId: cs.GetTransactionId(),
	}))
	if err != nil {
		t.Fatalf("pick locations: %v", err)
	}

	out := map[uint64]int64{}
	for _, loc := range res.Msg.GetLocations() {
		out[loc.GetRackId()] += loc.GetQuantity()
	}

	return out
}

// missingRows is the parcel's goods-missing trail rows, oldest first.
func missingRows(cs *inventoryv1.CustomShipment) []*inventoryv1.CustomShipmentLog {
	var out []*inventoryv1.CustomShipmentLog

	for _, l := range cs.GetLogs() {
		if l.GetKind() == inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_GOODS_MISSING {
			out = append(out, l)
		}
	}

	return out
}

func (f *csFixture) countLogs(t *testing.T, id uint64) (logs, lines int64) {
	t.Helper()

	f.db.Model(&models.CustomShipmentLog{}).Where("custom_shipment_id = ?", id).Count(&logs)
	f.db.Raw(`SELECT COUNT(*) FROM custom_shipment_missing_lines ml
		JOIN custom_shipment_logs l ON l.id = ml.custom_shipment_log_id WHERE l.custom_shipment_id = ?`, id).Scan(&lines)

	return logs, lines
}

// THE NOTE, AND NOTHING ELSE. Melati's sample of 4 Kaos Hitam drew 3 from Rak A and 1 from Rak B; A cannot find 2 on
// Rak A and says so with a note. One trail row of its own kind (never read as a cost edit) carries the lines and the
// note; the parcel stays Diminta — its row untouched, not a stock row written, no event — and A's answer carries no
// seller money. The open note is the parcel's goods_missing, read whole by both sides.
func TestCustomShipmentMissingReport_TheWarehouseNotesItAndNothingMoves(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 4)))
	item := csItemOf(t, created, wtKaosHitam).GetId()

	racks := f.takeRacks(t, created)
	if racks[f.rakA] != 3 || racks[f.rakB] != 1 {
		t.Fatalf("the take drew %v, want Rak A 3 and Rak B 1", racks)
	}

	var ctidBefore string
	f.db.Raw(`SELECT ctid::text FROM custom_shipments WHERE id = ?`, created.GetId()).Scan(&ctidBefore)

	batchesBefore, racksBefore := unitsAt(t, f.db, wtA, wtKaosHitam)

	var transactions int64
	f.db.Model(&models.InventoryTransaction{}).Count(&transactions)

	events := len(f.sent.events)

	cs := f.mustReport(t, created.GetId(), "  sudah cek rak sebelah  ", missingLine(item, f.rakA, 2))

	wantStatus(t, cs, inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED)

	rows := missingRows(cs)
	if len(cs.GetLogs()) != 2 || len(rows) != 1 {
		t.Fatalf("trail = %+v, want the create's row and one goods-missing row", cs.GetLogs())
	}

	row := rows[0]
	if row.GetFromStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED ||
		row.GetToStatus() != inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED ||
		row.GetActorUserId() != wtStaffA || row.GetDescription() != "sudah cek rak sebelah" {
		t.Fatalf("goods-missing row = %+v, want requested → requested by %d with the trimmed note", row, wtStaffA)
	}

	if cs.GetLogs()[0].GetKind() != inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_STATUS {
		t.Fatalf("the create's row is %v, want a status row", cs.GetLogs()[0].GetKind())
	}

	want := &inventoryv1.CustomShipmentMissingItem{
		ItemId: item, ProductId: wtKaosHitam, ProductCode: "KH-001", Name: "Kaos Hitam", RackId: f.rakA, RackCode: "rak-a",
		Quantity: 2,
	}
	if len(row.GetMissing()) != 1 || row.GetMissing()[0].String() != want.String() {
		t.Fatalf("goods-missing lines = %v, want %v", row.GetMissing(), want)
	}

	open := cs.GetGoodsMissing()
	if open.GetLogId() != row.GetId() || open.GetNote() != "sudah cek rak sebelah" || open.GetActorUserId() != wtStaffA ||
		open.GetAtUnix() == 0 || len(open.GetLines()) != 1 || open.GetLines()[0].String() != want.String() {
		t.Fatalf("goods_missing = %+v, want the note just written", open)
	}

	if set := moneySet(cs.ProtoReflect(), ""); len(set) != 0 {
		t.Fatalf("the warehouse's answer carries seller money: %v", set)
	}

	var ctidAfter string
	f.db.Raw(`SELECT ctid::text FROM custom_shipments WHERE id = ?`, created.GetId()).Scan(&ctidAfter)

	if ctidAfter != ctidBefore {
		t.Fatal("the note wrote the parcel's row — it must leave it as it was")
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != batchesBefore || r != racksBefore {
		t.Fatalf("A holds %d / %d Kaos Hitam after the note, want %d / %d — no stock moves", b, r, batchesBefore, racksBefore)
	}

	var transactionsAfter int64
	f.db.Model(&models.InventoryTransaction{}).Count(&transactionsAfter)

	if transactionsAfter != transactions {
		t.Fatalf("the note wrote %d stock transactions, want none", transactionsAfter-transactions)
	}

	if len(f.sent.events) != events {
		t.Fatalf("the note published %d events, want none — nothing posts", len(f.sent.events)-events)
	}

	// The team reads the same note — the warehouse's own words, never blanked like a cost edit's figures.
	team, err := f.detail(otMelati, created.GetId())
	if err != nil {
		t.Fatalf("detail as the team: %v", err)
	}

	if team.GetGoodsMissing().GetLogId() != row.GetId() || missingRows(team)[0].GetDescription() != "sudah cek rak sebelah" {
		t.Fatalf("the team reads goods_missing %+v, want the note", team.GetGoodsMissing())
	}

	warehouse, err := f.detail(wtA, created.GetId())
	if err != nil {
		t.Fatalf("detail as the warehouse: %v", err)
	}

	if missingRows(warehouse)[0].GetDescription() != "sudah cek rak sebelah" || warehouse.GetGoodsMissing() == nil {
		t.Fatalf("the warehouse reads %+v, want its own note", missingRows(warehouse))
	}

	if set := moneySet(warehouse.ProtoReflect(), ""); len(set) != 0 {
		t.Fatalf("the warehouse's detail carries seller money: %v", set)
	}
}

// A RESHIP'S LINES NAME NO RACK — its broken units were never on one (a-restocks-broken-units-are-just-broken-for-now):
// rack 0, at most the line's units.
func TestCustomShipmentMissingReport_AReshipNamesNoRack(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 3)))
	item := csItemOf(t, created, csWidget).GetId()

	cs := f.mustReport(t, created.GetId(), "", missingLine(item, 0, 3))

	got := missingRows(cs)[0].GetMissing()
	if len(got) != 1 || got[0].GetRackId() != 0 || got[0].GetRackCode() != "" || got[0].GetQuantity() != 3 ||
		got[0].GetProductCode() != "WG-1" {
		t.Fatalf("reship goods-missing lines = %v, want 3 Widgets on no rack", got)
	}

	if cs.GetGoodsMissing().GetNote() != "" {
		t.Fatalf("note = %q, want none — it is optional", cs.GetGoodsMissing().GetNote())
	}
}

// ONLY THE SHIPPING WAREHOUSE — the owning team and another warehouse read NotFound — and ONLY WHILE DIMINTA: picked,
// handed over or cancelled is refused, and a refusal writes nothing.
func TestCustomShipmentMissingReport_OnlyTheShippingWarehouseOnlyWhileRequested(t *testing.T) {
	f := csStocked(t)
	cs := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 1)))
	item := csItemOf(t, cs, wtKaosHitam).GetId()
	line := missingLine(item, f.rakA, 1)

	_, err := f.missingReport(otMelati, cs.GetId(), "", line)
	wantCode(t, err, connect.CodeNotFound, "noted by the owning team")

	_, err = f.missingReport(wtB, cs.GetId(), "", line)
	wantCode(t, err, connect.CodeNotFound, "noted by another warehouse")

	f.mustPick(t, cs.GetId())

	_, err = f.missingReport(wtA, cs.GetId(), "", line)
	wantCode(t, err, connect.CodeFailedPrecondition, "noted once picked")

	_, err = f.handover(wtA, cs.GetId(), nil, "")
	if err != nil {
		t.Fatalf("handover: %v", err)
	}

	_, err = f.missingReport(wtA, cs.GetId(), "", line)
	wantCode(t, err, connect.CodeFailedPrecondition, "noted once handed over")

	cancelled := f.mustCreate(t, csSample("k-2", csProduct(wtKaosPolos, 1)))

	_, err = f.cancel(otMelati, cancelled.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err = f.missingReport(wtA, cancelled.GetId(), "", missingLine(csItemOf(t, cancelled, wtKaosPolos).GetId(), f.rakB, 1))
	wantCode(t, err, connect.CodeFailedPrecondition, "noted once cancelled")

	for _, id := range []uint64{cs.GetId(), cancelled.GetId()} {
		if _, lines := f.countLogs(t, id); lines != 0 {
			t.Fatalf("parcel %d: a refused note wrote %d lines", id, lines)
		}
	}
}

// THE LINES ARE THE PARCEL'S: a line of another parcel, a rack the take did not draw this line from, more than it drew
// there, a line and rack twice, a reship line on a rack, more than a reship line holds, or rack 0 for a sample line its
// take drew from a rack — each refused, nothing written.
func TestCustomShipmentMissingReport_TheLinesAreTheParcels(t *testing.T) {
	f := csStocked(t)
	sample := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 4)))
	other := f.mustCreate(t, csSample("k-2", csProduct(wtKaosPolos, 1)))
	reship := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 2)))

	hitam := csItemOf(t, sample, wtKaosHitam).GetId()
	polos := csItemOf(t, other, wtKaosPolos).GetId()
	widget := csItemOf(t, reship, csWidget).GetId()

	cases := []struct {
		why   string
		id    uint64
		lines []*inventoryv1.CustomShipmentMissingLine
	}{
		{"another parcel's line", sample.GetId(), []*inventoryv1.CustomShipmentMissingLine{missingLine(polos, f.rakB, 1)}},
		{"a rack of another building", sample.GetId(), []*inventoryv1.CustomShipmentMissingLine{missingLine(hitam, f.rakB1, 1)}},
		{"more than the take drew on Rak B", sample.GetId(), []*inventoryv1.CustomShipmentMissingLine{missingLine(hitam, f.rakB, 2)}},
		{"one line and rack twice", sample.GetId(), []*inventoryv1.CustomShipmentMissingLine{
			missingLine(hitam, f.rakA, 1), missingLine(hitam, f.rakA, 1),
		}},
		{"no rack for a line the take drew from racks", sample.GetId(), []*inventoryv1.CustomShipmentMissingLine{missingLine(hitam, 0, 1)}},
		{"a reship line on a rack", reship.GetId(), []*inventoryv1.CustomShipmentMissingLine{missingLine(widget, f.rakA, 1)}},
		{"more than the reship line holds", reship.GetId(), []*inventoryv1.CustomShipmentMissingLine{missingLine(widget, 0, 3)}},
	}

	for _, c := range cases {
		_, err := f.missingReport(wtA, c.id, "", c.lines...)
		wantCode(t, err, connect.CodeInvalidArgument, c.why)
	}

	for _, id := range []uint64{sample.GetId(), reship.GetId()} {
		if logs, lines := f.countLogs(t, id); logs != 1 || lines != 0 {
			t.Fatalf("parcel %d: refusals left %d trail rows and %d lines, want the create's row only", id, logs, lines)
		}
	}

	// Each rack its own row and its own most: 3 on Rak A and 1 on Rak B in one note is exactly what the take drew.
	cs := f.mustReport(t, sample.GetId(), "", missingLine(hitam, f.rakA, 3), missingLine(hitam, f.rakB, 1))
	if got := missingRows(cs)[0].GetMissing(); len(got) != 2 || got[0].GetRackCode() != "rak-a" || got[1].GetRackCode() != "rak-b" {
		t.Fatalf("lines = %v, want Rak A then Rak B, as recorded", got)
	}
}

// RECORDED AGAIN — each note its own row; the latest is the open one, on the detail and on BOTH sides' list rows
// (the-goods-missing-badge-is-on-both-lists). Once picked (the goods turned up), none is open; the trail keeps both.
func TestCustomShipmentMissingReport_RecordedAgainTheLatestIsOpen(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 4)))
	quiet := f.mustCreate(t, csSample("k-2", csProduct(wtKaosPolos, 1)))
	item := csItemOf(t, created, wtKaosHitam).GetId()

	first := missingRows(f.mustReport(t, created.GetId(), "first look", missingLine(item, f.rakA, 1)))[0]
	cs := f.mustReport(t, created.GetId(), "second look", missingLine(item, f.rakA, 3), missingLine(item, f.rakB, 1))

	rows := missingRows(cs)
	if len(rows) != 2 || rows[0].GetId() != first.GetId() || rows[1].GetDescription() != "second look" {
		t.Fatalf("goods-missing rows = %+v, want both notes, oldest first", rows)
	}

	if cs.GetGoodsMissing().GetLogId() != rows[1].GetId() || len(cs.GetGoodsMissing().GetLines()) != 2 {
		t.Fatalf("goods_missing = %+v, want the second note", cs.GetGoodsMissing())
	}

	requested := &inventoryv1.CustomShipmentListFilter{Status: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED}

	for _, team := range []uint64{otMelati, wtA} {
		res := f.listAs(t, team, requested, 1, 20)

		var noted, none bool

		for _, row := range res.GetCustomShipments() {
			switch row.GetId() {
			case created.GetId():
				noted = row.GetGoodsMissing().GetLogId() == rows[1].GetId() && row.GetGoodsMissing().GetNote() == "second look" &&
					len(row.GetGoodsMissing().GetLines()) == 2 && row.GetGoodsMissing().GetLines()[0].GetRackCode() == "rak-a"
			case quiet.GetId():
				none = row.GetGoodsMissing() == nil
			}
		}

		if !noted || !none {
			t.Fatalf("team %d's list: noted %v, quiet without one %v — want the latest note on its row only", team, noted, none)
		}

		if team == wtA {
			if set := moneySet(res.ProtoReflect(), ""); len(set) != 0 {
				t.Fatalf("the warehouse's list carries seller money: %v", set)
			}
		}
	}

	f.mustPick(t, created.GetId())

	picked, err := f.detail(otMelati, created.GetId())
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if picked.GetGoodsMissing() != nil || len(missingRows(picked)) != 2 {
		t.Fatalf("picked: goods_missing %+v, %d notes on the trail — want none open, both kept", picked.GetGoodsMissing(),
			len(missingRows(picked)))
	}

	for _, row := range f.listAs(t, otMelati, nil, 1, 20).GetCustomShipments() {
		if row.GetId() == created.GetId() && row.GetGoodsMissing() != nil {
			t.Fatal("a picked parcel's list row still carries its note")
		}
	}
}

// THE NAMED UNITS ARE NOT OFFERED AGAIN (missing-reship-units-are-not-offered-again). Melati's Widget line has 3
// broken; a reship of all 3 is noted 2 gone (twice: 1, then 2 — two notes on one line name the same units, the most is
// 2) and then cancelled. The choices offer 1 (already_sent 0, not_found 2) and the create takes 1, not 2. A reship
// cancelled with NO note frees all its units as before (a-custom-shipment-is-cancelled-only-while-requested), and a
// note on a parcel that is NOT cancelled changes nothing (its units are on it anyway).
func TestCustomShipmentMissingReport_NamedReshipUnitsAreNotOfferedAgain(t *testing.T) {
	f := csStocked(t)
	reship := f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 3)))
	item := csItemOf(t, reship, csWidget).GetId()

	f.mustReport(t, reship.GetId(), "", missingLine(item, 0, 1))
	f.mustReport(t, reship.GetId(), "dibuang waktu Terima", missingLine(item, 0, 2))

	if line := offeredLine(f.reshipOptions(t, otMelati, "", 1, 20), f.line[csWidget]); line != nil {
		t.Fatalf("Widget offered %+v while its reship is live, want nothing — all 3 are on it", line)
	}

	_, err := f.cancel(otMelati, reship.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	line := offeredLine(f.reshipOptions(t, otMelati, "", 1, 20), f.line[csWidget])
	if line == nil || line.GetBroken() != 3 || line.GetAlreadySent() != 0 || line.GetNotFound() != 2 {
		t.Fatalf("Widget offered %+v, want 3 broken, 0 on a live reship, 2 noted not found", line)
	}

	_, err = f.create(f.csReship("r-2", csRestockLine(f.line[csWidget], 2)))
	wantCode(t, err, connect.CodeFailedPrecondition, "a reship of the 2 Widgets noted gone")

	f.mustCreate(t, f.csReship("r-3", csRestockLine(f.line[csWidget], 1)))

	if line := offeredLine(f.reshipOptions(t, otMelati, "", 1, 20), f.line[csWidget]); line != nil {
		t.Fatalf("Widget offered %+v, want nothing — 1 on a live reship, 2 gone", line)
	}

	// Gadget: 2 broken, a reship cancelled with no note — both free again.
	gadget := f.mustCreate(t, f.csReship("g-1", csRestockLine(f.line[csGadget], 2)))

	_, err = f.cancel(otMelati, gadget.GetId())
	if err != nil {
		t.Fatalf("cancel the Gadget reship: %v", err)
	}

	if line := offeredLine(f.reshipOptions(t, otMelati, "", 1, 20), f.line[csGadget]); line == nil ||
		line.GetAlreadySent() != 0 || line.GetNotFound() != 0 {
		t.Fatalf("Gadget offered %+v, want both free again", line)
	}

	ids := optionIDs(f.reshipOptions(t, otMelati, "", 1, 20))
	if !slices.Contains(ids, f.restock) {
		t.Fatalf("offered restocks %v, want %d (its Gadgets are free)", ids, f.restock)
	}
}

// EACH TRAIL ROW SAYS WHAT IT IS — a cost edit and a goods-missing note are both from = to, so the kind tells them apart:
// the warehouse reads a cost edit's figures blanked (a-warehouse-sees-no-seller-money) and its own note whole.
func TestCustomShipmentMissingReport_TheTrailSaysEachRowsKind(t *testing.T) {
	f := csStocked(t)
	created := f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 1)))

	_, err := f.costSet(otMelati, created.GetId(), wtAccount, 20000)
	if err != nil {
		t.Fatalf("cost set: %v", err)
	}

	f.mustReport(t, created.GetId(), "rak kosong", missingLine(csItemOf(t, created, wtKaosHitam).GetId(), f.rakA, 1))
	f.mustPick(t, created.GetId())

	want := []inventoryv1.CustomShipmentLogKind{
		inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_STATUS,
		inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_COST_EDIT,
		inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_GOODS_MISSING,
		inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_STATUS,
	}

	for _, team := range []uint64{otMelati, wtA} {
		cs, detailErr := f.detail(team, created.GetId())
		if detailErr != nil {
			t.Fatalf("detail as %d: %v", team, detailErr)
		}

		var got []inventoryv1.CustomShipmentLogKind
		for _, l := range cs.GetLogs() {
			got = append(got, l.GetKind())
		}

		if !slices.Equal(got, want) {
			t.Fatalf("team %d reads kinds %v, want %v", team, got, want)
		}

		edit, note := cs.GetLogs()[1].GetDescription(), cs.GetLogs()[2].GetDescription()
		if note != "rak kosong" || (team == wtA) != (edit == "") {
			t.Fatalf("team %d reads the cost edit %q and the note %q — the warehouse never the figures, both the note",
				team, edit, note)
		}

		if len(cs.GetLogs()[1].GetMissing()) != 0 || len(cs.GetLogs()[2].GetMissing()) != 1 {
			t.Fatalf("team %d: only the note carries lines, got %+v", team, cs.GetLogs())
		}
	}
}
