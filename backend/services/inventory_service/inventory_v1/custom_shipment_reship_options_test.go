package inventory_v1_test

import (
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

func (f *csFixture) reshipOptions(t *testing.T, teamID uint64, q string, page, limit uint32) *inventoryv1.CustomShipmentReshipOptionsResponse {
	t.Helper()

	res, err := f.svc.CustomShipmentReshipOptions(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentReshipOptionsRequest{
		TeamId: teamID, Q: q, Page: &commonv1.CommonPagination{Page: page, Limit: limit},
	}))
	if err != nil {
		t.Fatalf("reship options of team %d: %v", teamID, err)
	}

	return res.Msg
}

// optionIDs is the restocks offered, in order.
func optionIDs(res *inventoryv1.CustomShipmentReshipOptionsResponse) []uint64 {
	ids := make([]uint64, 0, len(res.GetOptions()))
	for _, o := range res.GetOptions() {
		ids = append(ids, o.GetRestockId())
	}

	return ids
}

// offeredLine is the line of a restock line in the options, or nil when it is not offered.
func offeredLine(res *inventoryv1.CustomShipmentReshipOptionsResponse, restockItemID uint64) *inventoryv1.CustomShipmentReshipLine {
	for _, o := range res.GetOptions() {
		for _, line := range o.GetLines() {
			if line.GetRestockItemId() == restockItemID {
				return line
			}
		}
	}

	return nil
}

// receivedWithBroken is one more of Melati's restocks to A, received with `broken` of its 5 Widgets broken.
func (f *csFixture) receivedWithBroken(t *testing.T, broken int64) uint64 {
	t.Helper()

	rr := csRestock(t, f.svc, otMelati,
		&inventoryv1.RestockRequestItem{ProductId: csWidget, ProductCode: "WG-1", Name: "Widget", Count: 5, Total: 50000, SupplierId: csSupplierA},
	)

	_, err := f.svc.RestockRequestAccept(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wtA, RequestId: rr.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: rr.GetItems()[0].GetId(), ReceivedCount: 5, BrokenCount: broken, Placements: placedOn(f.rakA, 5-broken)},
		},
	}))
	if err != nil {
		t.Fatalf("accept restock %d: %v", rr.GetId(), err)
	}

	return rr.GetId()
}

// setAcceptedAt dates a restock's accept.
func (f *csFixture) setAcceptedAt(t *testing.T, restockID uint64, at time.Time) {
	t.Helper()

	err := f.db.
		Model(&models.Restock{}).
		Where("id = ?", restockID).
		Update("accepted_at", at).
		Error
	if err != nil {
		t.Fatalf("date restock %d's accept: %v", restockID, err)
	}
}

// setCustomShipmentStatus moves a parcel by hand — the moves are P3's.
func (f *csFixture) setCustomShipmentStatus(t *testing.T, id uint64, status models.CustomShipmentStatus) {
	t.Helper()

	err := f.db.
		Model(&models.CustomShipment{}).
		Where("id = ?", id).
		Update("status", status).
		Error
	if err != nil {
		t.Fatalf("move parcel %d to %s: %v", id, status, err)
	}
}

// What a reship can send: Melati's RECEIVED restock, with only its BROKEN lines — Widget's 3 (its note "crushed",
// supplier 31) and Gadget's 2 (supplier 32, store 55) — never Gizmo (nothing broken), never the restock still on its way,
// never Sinar's. Sinar is offered only its own.
func TestCustomShipmentReshipOptions_OffersTheTeamsReceivedBrokenUnits(t *testing.T) {
	f := csStocked(t)

	err := f.db.
		Model(&models.RestockItem{}).
		Where("id = ?", f.line[csGadget]).
		Update("supplier_channel_id", 55).
		Error
	if err != nil {
		t.Fatalf("name Gadget's store: %v", err)
	}

	res := f.reshipOptions(t, otMelati, "", 1, 20)

	if got := optionIDs(res); !slices.Equal(got, []uint64{f.restock}) {
		t.Fatalf("Melati is offered restocks %v, want only its received one %d (not the ongoing %d, not Sinar's %d)",
			got, f.restock, f.ongoing, f.sinarRestock)
	}

	if info := res.GetPageInfo(); info.GetTotalItems() != 1 || info.GetTotalPage() != 1 || info.GetCurrentPage() != 1 {
		t.Fatalf("page info = %+v, want one restock on one page", info)
	}

	option := res.GetOptions()[0]
	if option.GetTeamId() != otMelati || option.GetWarehouseId() != wtA || option.GetAcceptedAtUnix() == 0 {
		t.Fatalf("option = %+v, want Melati's restock to A with its accept time", option)
	}

	want := []*inventoryv1.CustomShipmentReshipLine{
		{RestockItemId: f.line[csWidget], ProductId: csWidget, ProductCode: "WG-1", Name: "Widget", Broken: 3, BrokenNote: "crushed",
			SupplierId: csSupplierA},
		{RestockItemId: f.line[csGadget], ProductId: csGadget, ProductCode: "GD-1", Name: "Gadget", Broken: 2,
			SupplierId: csSupplierB, SupplierChannelId: 55},
	}

	if got := option.GetLines(); len(got) != len(want) {
		t.Fatalf("lines = %v, want Widget's and Gadget's broken units, not Gizmo", got)
	}

	for i, line := range option.GetLines() {
		if !proto.Equal(line, want[i]) {
			t.Fatalf("line %d = %v, want %v", i, line, want[i])
		}
	}

	sinar := f.reshipOptions(t, otSinar, "", 1, 20)
	if got := optionIDs(sinar); !slices.Equal(got, []uint64{f.sinarRestock}) || sinar.GetOptions()[0].GetLines()[0].GetBroken() != 2 {
		t.Fatalf("Sinar is offered %v, want only its own %d with its 2 broken", got, f.sinarRestock)
	}
}

// A LIVE RESHIP HOLDS ITS UNITS (the-custom-shipments-prototype-is-accepted: at most the broken count minus the units
// already on another live reship): Widget's line shows what is already sent, leaves once every broken unit is on a
// reship, and the restock leaves once no line has a unit free. A CANCELLED reship's units are free again
// (a-custom-shipment-is-cancelled-only-while-requested).
func TestCustomShipmentReshipOptions_LiveReshipsHoldTheirUnits(t *testing.T) {
	f := csStocked(t)

	f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 2)))

	widget := offeredLine(f.reshipOptions(t, otMelati, "", 1, 20), f.line[csWidget])
	if widget == nil || widget.GetBroken() != 3 || widget.GetAlreadySent() != 2 {
		t.Fatalf("Widget's line after a reship of 2 = %v, want 3 broken, 2 already sent", widget)
	}

	f.mustCreate(t, f.csReship("r-2", csRestockLine(f.line[csWidget], 1)))

	res := f.reshipOptions(t, otMelati, "", 1, 20)
	if offeredLine(res, f.line[csWidget]) != nil || offeredLine(res, f.line[csGadget]) == nil {
		t.Fatalf("every Widget on a reship: options = %v, want Gadget's line only", res.GetOptions())
	}

	gadgetReship := f.csReship("r-3", csRestockLine(f.line[csGadget], 2))
	gadget := f.mustCreate(t, gadgetReship)

	res = f.reshipOptions(t, otMelati, "", 1, 20)
	if len(res.GetOptions()) != 0 || res.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("every broken unit on a reship: options = %v (counted %d), want none", optionIDs(res), res.GetPageInfo().GetTotalItems())
	}

	f.setCustomShipmentStatus(t, gadget.GetId(), models.CustomShipmentCancelled)

	res = f.reshipOptions(t, otMelati, "", 1, 20)
	if line := offeredLine(res, f.line[csGadget]); line == nil || line.GetAlreadySent() != 0 || line.GetBroken() != 2 {
		t.Fatalf("Gadget's reship cancelled: its line = %v, want both broken units free again", line)
	}

	// Picked and handed-over reships still hold theirs — only a cancel frees them.
	for _, status := range []models.CustomShipmentStatus{models.CustomShipmentPicked, models.CustomShipmentHandedOver} {
		f.setCustomShipmentStatus(t, gadget.GetId(), status)

		if offeredLine(f.reshipOptions(t, otMelati, "", 1, 20), f.line[csGadget]) != nil {
			t.Fatalf("a %s reship's units are offered again", status)
		}
	}
}

// THE OFFER IS WHAT THE CREATE ACCEPTS: a line offered with N units free takes a reship of N and refuses N+1 — the
// options and createReship count the same broken rows and the same live reships.
func TestCustomShipmentReshipOptions_OffersWhatCreateAccepts(t *testing.T) {
	f := csStocked(t)

	f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 1)))

	for i, line := range f.reshipOptions(t, otMelati, "", 1, 20).GetOptions()[0].GetLines() {
		free := line.GetBroken() - line.GetAlreadySent()

		_, err := f.create(f.csReship("over-"+itoa(uint64(i)), csRestockLine(line.GetRestockItemId(), free+1)))
		wantCode(t, err, connect.CodeFailedPrecondition, "one unit over what is offered on line "+itoa(line.GetRestockItemId()))

		f.mustCreate(t, f.csReship("all-"+itoa(uint64(i)), csRestockLine(line.GetRestockItemId(), free)))
	}

	if res := f.reshipOptions(t, otMelati, "", 1, 20); len(res.GetOptions()) != 0 {
		t.Fatalf("every offered unit sent: still offered %v", optionIDs(res))
	}
}

// NEWEST ACCEPT FIRST — by the accept, not the restock's number — and paged: the pages are disjoint, together the whole
// offer, the page info counting the whole.
func TestCustomShipmentReshipOptions_NewestAcceptFirstAndPaged(t *testing.T) {
	f := csStocked(t)

	second := f.receivedWithBroken(t, 1)
	third := f.receivedWithBroken(t, 2)

	now := time.Now()
	f.setAcceptedAt(t, f.restock, now.Add(-48*time.Hour))
	f.setAcceptedAt(t, second, now)
	f.setAcceptedAt(t, third, now.Add(-24*time.Hour))

	first := f.reshipOptions(t, otMelati, "", 1, 2)
	next := f.reshipOptions(t, otMelati, "", 2, 2)

	if got := optionIDs(first); !slices.Equal(got, []uint64{second, third}) {
		t.Fatalf("page 1 = %v, want the newest accepts %v", got, []uint64{second, third})
	}

	if got := optionIDs(next); !slices.Equal(got, []uint64{f.restock}) {
		t.Fatalf("page 2 = %v, want the oldest accept %d", got, f.restock)
	}

	for i, res := range []*inventoryv1.CustomShipmentReshipOptionsResponse{first, next} {
		if info := res.GetPageInfo(); info.GetTotalItems() != 3 || info.GetTotalPage() != 2 || info.GetCurrentPage() != uint32(i+1) {
			t.Fatalf("page %d info = %+v, want 3 restocks on 2 pages", i+1, info)
		}
	}

	// A page past the end has no row to carry the count — it is counted alone.
	past := f.reshipOptions(t, otMelati, "", 3, 2)
	if info := past.GetPageInfo(); len(past.GetOptions()) != 0 || info.GetTotalItems() != 3 || info.GetTotalPage() != 2 {
		t.Fatalf("page 3 = %v with info %+v, want empty, still 3 restocks on 2 pages", optionIDs(past), info)
	}

	if got := first.GetOptions()[1].GetLines(); len(got) != 1 || got[0].GetBroken() != 2 {
		t.Fatalf("the third restock's lines = %v, want its 2 broken Widgets", got)
	}
}

// FREE TEXT: the restock's number (with or without its #) or a FREE broken line's product code or name. A line whose
// broken units are all on a reship no longer matches — its restock is offered for what it still has.
func TestCustomShipmentReshipOptions_Search(t *testing.T) {
	f := csStocked(t)

	other := f.receivedWithBroken(t, 1)

	cases := []struct {
		name string
		q    string
		want []uint64
	}{
		{"its number with the hash", "#" + itoa(f.restock), []uint64{f.restock}},
		{"its number bare", " " + itoa(other) + " ", []uint64{other}},
		{"another team's number", "#" + itoa(f.sinarRestock), []uint64{}},
		{"a broken line's product code, any case", "gd-1", []uint64{f.restock}},
		{"a broken line's product name", "Gadg", []uint64{f.restock}},
		{"a line with nothing broken", "gizmo", []uint64{}},
		{"text matching nothing", "zzz", []uint64{}},
	}

	for _, c := range cases {
		res := f.reshipOptions(t, otMelati, c.q, 1, 20)

		if got := optionIDs(res); !slices.Equal(got, c.want) {
			t.Fatalf("%s (%q): offered %v, want %v", c.name, c.q, got, c.want)
		}

		if res.GetPageInfo().GetTotalItems() != uint64(len(c.want)) {
			t.Fatalf("%s: counted %d, want %d", c.name, res.GetPageInfo().GetTotalItems(), len(c.want))
		}
	}

	// Widget's broken units all on reships: "widget" finds the other restock only, though the first still has a
	// broken Gadget.
	f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 3)))

	if got := optionIDs(f.reshipOptions(t, otMelati, "widget", 1, 20)); !slices.Equal(got, []uint64{other}) {
		t.Fatalf("\"widget\" after the first restock's Widgets were all sent = %v, want only %d", got, other)
	}
}

// ONLY A RECEIVED RESTOCK: broken units on a restock that is not accepted (a row put there by hand — Terima is the one
// writer) are never offered; the create refuses that restock too.
func TestCustomShipmentReshipOptions_OnlyAReceivedRestock(t *testing.T) {
	f := csStocked(t)

	err := f.db.Create(&models.RestockProblemItem{
		RestockID: f.ongoing, ProductID: csWidget, ProblemType: "broken", Count: 1,
	}).Error
	if err != nil {
		t.Fatalf("a broken row on the ongoing restock: %v", err)
	}

	if got := optionIDs(f.reshipOptions(t, otMelati, "", 1, 20)); !slices.Equal(got, []uint64{f.restock}) {
		t.Fatalf("offered %v, want only the received restock %d — never the ongoing %d", got, f.restock, f.ongoing)
	}
}
