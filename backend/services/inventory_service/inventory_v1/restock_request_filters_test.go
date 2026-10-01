package inventory_v1_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// listRestocks and listTotal are the same call read two ways — the ROWS and the PAGER's count. They
// are separate helpers because a filter can get one right and the other wrong: applying the narrowing
// after the Count() is exactly how a list shows three rows and offers five pages of them.
func listRestocks(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	team uint64,
	filter *inventoryv1.RestockRequestListFilter,
) []*inventoryv1.RestockRequest {
	t.Helper()

	resp, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: team, Filter: filter, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	return requestRows(resp.Msg)
}

func listTotal(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	team uint64,
	filter *inventoryv1.RestockRequestListFilter,
) uint64 {
	t.Helper()

	resp, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: team, Filter: filter, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	return resp.Msg.GetPageInfo().GetTotalItems()
}

func formatID(id uint64) string {
	return strconv.FormatUint(id, 10)
}

// containsID is for the searches that legitimately return MORE than the row being asked about — a
// bare number matches text as well as the id, so the assertion there is "it found this one", not
// "it found only this one".
func containsID(rows []*inventoryv1.RestockRequest, id uint64) bool {
	for _, r := range rows {
		if r.GetId() == id {
			return true
		}
	}

	return false
}

// The actor columns and the list filters they enable (owner): who raised a restock, who counted it,
// and the warehouse / date-range / free-text lenses over the list.

// WHO DID WHAT. The point of the test is that the two ids come from the CALLER'S IDENTITY and are
// therefore DIFFERENT people: a buyer raises the request, a warehouse hand counts it. A handler that
// read either from the request body, or stamped one actor for both sides, passes a
// same-user test and fails this one.
func TestRestockRequest_RecordsWhoRaisedAndWhoAccepted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const sellingTeam, warehouse uint64 = 2, 5
	const buyer, warehouseHand uint64 = 7, 9

	buyerCtx := ctxUser(buyer)
	handCtx := ctxUser(warehouseHand)

	create := func() *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(buyerCtx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 1000},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	// A PENDING request names its author and nothing else — nobody has accepted or cancelled it.
	raised := create()

	if raised.GetCreatedByUserId() != buyer {
		t.Fatalf("created_by = %d, want the caller %d", raised.GetCreatedByUserId(), buyer)
	}

	if raised.GetAcceptedByUserId() != 0 || raised.GetAcceptedAtUnix() != 0 {
		t.Fatalf("a pending request claims an acceptor: by=%d at=%d",
			raised.GetAcceptedByUserId(), raised.GetAcceptedAtUnix())
	}

	if raised.GetCancelledAtUnix() != 0 {
		t.Fatalf("a pending request claims a cancellation at %d", raised.GetCancelledAtUnix())
	}

	// ACCEPTED — by the warehouse hand, not by the buyer who raised it.
	before := time.Now().Add(-time.Second).Unix()

	accepted, err := svc.RestockRequestFulfill(handCtx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: raised.GetId(), Lines: allArrived(raised),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	got := accepted.Msg.GetRequest()

	if got.GetAcceptedByUserId() != warehouseHand {
		t.Fatalf("accepted_by = %d, want the accepting caller %d", got.GetAcceptedByUserId(), warehouseHand)
	}

	// The author must SURVIVE acceptance. Overwriting it with the acceptor is the obvious way to get
	// this wrong, and it would erase the only record of who committed the money.
	if got.GetCreatedByUserId() != buyer {
		t.Fatalf("created_by = %d after acceptance, want the original author %d",
			got.GetCreatedByUserId(), buyer)
	}

	if got.GetAcceptedAtUnix() < before {
		t.Fatalf("accepted_at = %d, want a stamp at or after %d", got.GetAcceptedAtUnix(), before)
	}

	// CANCELLED — its own timestamp, and still no acceptor.
	toCancel := create()

	cancelResp, err := svc.RestockRequestCancel(buyerCtx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: sellingTeam, RequestId: toCancel.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	killed := cancelResp.Msg.GetRequest()

	if killed.GetCancelledAtUnix() < before {
		t.Fatalf("cancelled_at = %d, want a stamp at or after %d", killed.GetCancelledAtUnix(), before)
	}

	if killed.GetAcceptedAtUnix() != 0 || killed.GetAcceptedByUserId() != 0 {
		t.Fatalf("a cancelled request claims an acceptor: by=%d at=%d",
			killed.GetAcceptedByUserId(), killed.GetAcceptedAtUnix())
	}

	// And the actors survive the LIST read, which is where the columns actually render — a mapper that
	// only fills them on the write response would look correct in every assertion above.
	listed := listRestocks(t, svc, buyerCtx, sellingTeam, &inventoryv1.RestockRequestListFilter{})

	for _, r := range listed {
		if r.GetCreatedByUserId() != buyer {
			t.Fatalf("list row #%d created_by = %d, want %d", r.GetId(), r.GetCreatedByUserId(), buyer)
		}
	}
}

// The WAREHOUSE lens (owner): a selling team ships to several, and this is how it asks "what is going
// to Jakarta".
func TestRestockRequestList_FilterByWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2
	const jakarta, surabaya uint64 = 5, 6

	create := func(warehouse uint64) *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	toJakarta := create(jakarta)
	create(surabaya)
	create(surabaya)

	// 0 is every warehouse, not "warehouse zero".
	if all := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{}); len(all) != 3 {
		t.Fatalf("unfiltered = %d, want 3", len(all))
	}

	only := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{WarehouseId: jakarta})
	if len(only) != 1 || only[0].GetId() != toJakarta.GetId() {
		t.Fatalf("jakarta lens = %+v, want just #%d", only, toJakarta.GetId())
	}

	// The pager must count the FILTERED set, or it offers pages that do not exist.
	if total := listTotal(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{WarehouseId: surabaya}); total != 2 {
		t.Fatalf("surabaya total = %d, want 2", total)
	}
}

// THE DATE RANGE, AND WHICH DATE IT IS ABOUT (owner).
//
// The load-bearing assertion is the last one: a range on ACCEPTED must EXCLUDE requests nobody has
// accepted. "Accepted last week" cannot be true of a pending request, and a filter that let them
// through would answer a different question than the one asked.
func TestRestockRequestList_FilterByDateField(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	create := func() *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	create() // stays pending — the row every "accepted"/"cancelled" range must leave out

	toAccept := create()
	_, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: toAccept.GetId(), Lines: allArrived(toAccept),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	toCancel := create()
	_, err = svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: sellingTeam, RequestId: toCancel.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	// A window wide enough to hold everything this test just wrote, and narrow enough to be a filter.
	wideFrom := time.Now().Add(-time.Hour).Unix()
	wideTo := time.Now().Add(time.Hour).Unix()

	// CREATED (and UNSPECIFIED, which reads as created) sees all three.
	for _, field := range []inventoryv1.RestockDateField{
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_UNSPECIFIED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED,
	} {
		rows := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{
			DateField: field, FromUnix: wideFrom, ToUnix: wideTo,
		})
		if len(rows) != 3 {
			t.Fatalf("created range (field=%v) = %d rows, want 3", field, len(rows))
		}
	}

	// ACCEPTED sees ONLY the accepted one — the pending and cancelled rows have no such date.
	acceptedRows := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{
		DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED,
		FromUnix:  wideFrom, ToUnix: wideTo,
	})
	if len(acceptedRows) != 1 || acceptedRows[0].GetId() != toAccept.GetId() {
		t.Fatalf("accepted range = %+v, want just #%d", acceptedRows, toAccept.GetId())
	}

	// CANCELLED, the same rule in the other direction.
	cancelledRows := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{
		DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CANCELLED,
		FromUnix:  wideFrom, ToUnix: wideTo,
	})
	if len(cancelledRows) != 1 || cancelledRows[0].GetId() != toCancel.GetId() {
		t.Fatalf("cancelled range = %+v, want just #%d", cancelledRows, toCancel.GetId())
	}

	// An OPEN END is a real filter, not "no filter": a `to` alone means everything up to then.
	if rows := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{
		ToUnix: time.Now().Add(-time.Hour).Unix(),
	}); len(rows) != 0 {
		t.Fatalf("everything before an hour ago = %d rows, want 0", len(rows))
	}

	// Both bounds 0 = no filter at all, and the pending row is back. A date FIELD with no window must
	// not narrow anything on its own — otherwise merely choosing "Accepted" in the picker would hide
	// every pending restock before the person had picked any dates.
	if rows := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{
		DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED,
	}); len(rows) != 3 {
		t.Fatalf("no range at all = %d rows, want 3 (the date field must not filter on its own)", len(rows))
	}
}

// THE SEARCH BOX (owner) — over what a person actually remembers about a restock.
func TestRestockRequestList_Search(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	create := func(orderRef, receipt, sku, name string) *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			OrderRef: orderRef, Receipt: receipt,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: sku, Name: name, Quantity: 1, TotalPrice: 100},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	kaos := create("MP-4127", "JP1830042", "KAOS-CC30-HTM-L", "Kaos Polos Hitam")
	tumbler := create("MP-4131", "JP1830099", "TMB-500-005", "Tumbler Stainless")

	search := func(q string) []*inventoryv1.RestockRequest {
		t.Helper()

		return listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{Q: q})
	}

	// Empty is not a filter.
	if rows := search(""); len(rows) != 2 {
		t.Fatalf("empty search = %d rows, want 2", len(rows))
	}

	// …nor is whitespace, which is what a cleared box often actually contains.
	if rows := search("   "); len(rows) != 2 {
		t.Fatalf("whitespace search = %d rows, want 2", len(rows))
	}

	cases := []struct {
		name string
		q    string
		want uint64
	}{
		{"order ref", "MP-4127", kaos.GetId()},
		{"tracking number", "JP1830099", tumbler.GetId()},
		{"sku fragment", "cc30", kaos.GetId()},
		{"product name", "tumbler", tumbler.GetId()},
		// Case-insensitive both ways: the stored value is upper, the term is lower, and vice versa.
		{"upper term against a lower name", "KAOS POLOS", kaos.GetId()},
	}

	for _, tc := range cases {
		rows := search(tc.q)
		if len(rows) != 1 || rows[0].GetId() != tc.want {
			t.Fatalf("%s (%q) = %+v, want just #%d", tc.name, tc.q, rows, tc.want)
		}
	}

	// THE HASH FORM IS THE EXACT ONE: "#9" is a person saying "I mean the number", so it returns that
	// one row and nothing else.
	exact := search("#" + formatID(kaos.GetId()))
	if len(exact) != 1 || exact[0].GetId() != kaos.GetId() {
		t.Fatalf("hash id search = %+v, want just #%d", exact, kaos.GetId())
	}

	// #31 must not find 310 — the number matches WHOLE, or asking for one delivery returns ten.
	if rows := search("#" + formatID(kaos.GetId()) + "0"); len(rows) != 0 {
		t.Fatalf("hash search for a longer id = %+v, want 0 (the id must match whole)", rows)
	}

	// A BARE number searches the id AND the text, and that is deliberate — "500" is as likely to be a
	// SKU fragment as a restock number. So it FINDS the row by id...
	bare := search(formatID(kaos.GetId()))
	if !containsID(bare, kaos.GetId()) {
		t.Fatalf("bare id search = %+v, want it to include #%d", bare, kaos.GetId())
	}

	// …and a digit that appears inside a tracking number legitimately matches that row too. Asserting
	// it explicitly, because it is the ambiguity the hash form exists to resolve rather than a bug:
	// tumbler's receipt is JP1830099, so a search for "9" reaches it.
	nine := search("9")
	if !containsID(nine, tumbler.GetId()) {
		t.Fatalf("bare \"9\" = %+v, want it to include #%d via receipt JP1830099",
			nine, tumbler.GetId())
	}

	// A "#" not followed by a number is NOT an id, and the term keeps its hash into the text search
	// rather than being stripped — so "#MP-4127" matches nothing while "MP-4127" (asserted above)
	// matches the row. The hash is not decoration to be discarded: a reference can legitimately
	// contain one ("PO#4127"), and stripping it would make that reference unfindable.
	if rows := search("#MP-4127"); len(rows) != 0 {
		t.Fatalf("hash + non-number = %+v, want 0 — the term is searched verbatim", rows)
	}

	// A term that matches nothing returns nothing — not everything, which is what a filter dropped on
	// an empty condition list would do.
	if rows := search("no-such-thing"); len(rows) != 0 {
		t.Fatalf("unmatched search = %d rows, want 0", len(rows))
	}

	// The pager counts the FILTERED set.
	if total := listTotal(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{Q: "tumbler"}); total != 1 {
		t.Fatalf("search total = %d, want 1", total)
	}
}

// THE REQUESTING-TEAM LENS — the warehouse side's mirror of the warehouse lens above (owner).
//
// The load-bearing assertion is the last one, and it is about SCOPE rather than filtering. The list's
// scope is `requesting_team_id = team OR warehouse_id = team`, so a warehouse naming a selling team
// must get that team's restocks ADDRESSED TO ITSELF — not that team's whole book. A filter written as
// a replacement for the scope instead of a narrowing of it passes every other assertion here and
// hands one warehouse another's inbound queue.
func TestRestockRequestList_FilterByRequestingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const bandung, medan uint64 = 2, 3
	const jakarta, surabaya uint64 = 5, 6

	create := func(seller, warehouse uint64) *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: seller, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	fromBandung := create(bandung, jakarta)
	create(medan, jakarta)
	create(medan, jakarta)

	// Bandung also ships to the OTHER warehouse. This row is what the scope must keep out of Jakarta's
	// answer even when Jakarta asks for Bandung by name.
	elsewhere := create(bandung, surabaya)

	// 0 is every team, not "team zero" — Jakarta sees its whole queue.
	if all := listRestocks(t, svc, ctx, jakarta, &inventoryv1.RestockRequestListFilter{}); len(all) != 3 {
		t.Fatalf("unfiltered = %d, want 3", len(all))
	}

	only := listRestocks(t, svc, ctx, jakarta, &inventoryv1.RestockRequestListFilter{RequestingTeamId: bandung})
	if len(only) != 1 || only[0].GetId() != fromBandung.GetId() {
		t.Fatalf("bandung lens = %+v, want just #%d", only, fromBandung.GetId())
	}

	// The pager must count the FILTERED set, or it offers pages that do not exist.
	if total := listTotal(t, svc, ctx, jakarta, &inventoryv1.RestockRequestListFilter{RequestingTeamId: medan}); total != 2 {
		t.Fatalf("medan total = %d, want 2", total)
	}

	// THE SCOPE STILL HOLDS. Bandung's Surabaya-bound restock is Bandung's, and Jakarta asked for
	// Bandung — and must still not see it.
	if containsID(only, elsewhere.GetId()) {
		t.Fatalf("jakarta saw #%d, a bandung restock addressed to surabaya — the filter widened the scope",
			elsewhere.GetId())
	}
}

// BY PERSON (owner): whose orders these are, and who was at the door. Two filters, not one — see the
// proto — so the test that matters most is the one where they COMBINE.
func TestRestockRequestList_FilterByActor(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const sellingTeam, warehouse uint64 = 2, 5
	const rina, budi uint64 = 7, 8
	const hand, otherHand uint64 = 9, 11

	create := func(author uint64) *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(ctxUser(author), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2, TotalPrice: 200},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	accept := func(by uint64, r *inventoryv1.RestockRequest) {
		t.Helper()

		_, err := svc.RestockRequestFulfill(ctxUser(by), connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
			TeamId: warehouse, RequestId: r.GetId(), Lines: allArrived(r),
		}))
		if err != nil {
			t.Fatalf("fulfil: %v", err)
		}
	}

	rinasAccepted := create(rina)
	rinasPending := create(rina)
	budis := create(budi)

	accept(hand, rinasAccepted)
	accept(otherHand, budis)

	ctx := ctxUser(rina)

	// WHO RAISED IT — both of Rina's, accepted or not.
	raised := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{CreatedByUserId: rina})
	if len(raised) != 2 {
		t.Fatalf("rina raised = %d rows, want 2", len(raised))
	}

	if containsID(raised, budis.GetId()) {
		t.Fatalf("rina's orders include #%d, which Budi raised", budis.GetId())
	}

	// The pager must count the FILTERED set, or it offers pages that do not exist.
	if total := listTotal(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{CreatedByUserId: budi}); total != 1 {
		t.Fatalf("budi total = %d, want 1", total)
	}

	// WHO WAS AT THE DOOR. It implies an accepted restock, so Rina's PENDING one must drop out without
	// a status filter having to say so — that is the whole reason this is a separate field.
	atDoor := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{AcceptedByUserId: hand})
	if len(atDoor) != 1 || atDoor[0].GetId() != rinasAccepted.GetId() {
		t.Fatalf("accepted-by lens = %+v, want just #%d", atDoor, rinasAccepted.GetId())
	}

	// Named rather than counted, because WHICH row leaked is the useful failure: Rina raised this one
	// too, so a filter that matched on the wrong column would return it and the count above would
	// still be 1.
	if containsID(atDoor, rinasPending.GetId()) {
		t.Fatalf("accepted-by lens includes #%d, which nobody has accepted", rinasPending.GetId())
	}

	// BOTH SET IS AN AND, not an either. This is the assertion that fails if someone "helpfully" ORs
	// them: Budi raised his, and `hand` never touched it, so the pair must match nothing.
	both := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{
		CreatedByUserId: budi, AcceptedByUserId: hand,
	})
	if len(both) != 0 {
		t.Fatalf("budi+hand = %+v, want nothing — the two filters ORed instead of ANDing", both)
	}

	// …and the pair that IS true of one row finds exactly it.
	pair := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{
		CreatedByUserId: rina, AcceptedByUserId: hand,
	})
	if len(pair) != 1 || pair[0].GetId() != rinasAccepted.GetId() {
		t.Fatalf("rina+hand = %+v, want just #%d", pair, rinasAccepted.GetId())
	}

	// A person who never touched this team's restocks matches nothing — NOT everything, which is what
	// an unguarded `= ?` against a zero would do.
	if none := listRestocks(t, svc, ctx, sellingTeam, &inventoryv1.RestockRequestListFilter{CreatedByUserId: 4242}); len(none) != 0 {
		t.Fatalf("a stranger's orders = %+v, want nothing", none)
	}
}

// THE HISTORY (00019): create, edit, edit, accept — four events, in order, each naming the person who
// did it. This is the test the event table exists for, and the assertion that matters is the SECOND
// edit: two columns could have recorded only the last one.
func TestRestockRequest_EventHistory(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const sellingTeam, warehouse uint64 = 2, 5
	const buyer, warehouseHand uint64 = 7, 9

	buyerCtx := ctxUser(buyer)
	handCtx := ctxUser(warehouseHand)

	created, err := svc.RestockRequestCreate(buyerCtx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 1000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetRequest().GetId()

	// TWICE, because "edited five times reads as edited once" is exactly what an `updated_by` column
	// would have done and what this table exists to avoid.
	for _, qty := range []int64{12, 15} {
		_, updErr := svc.RestockRequestUpdate(buyerCtx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
			TeamId: sellingTeam, RequestId: id, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: qty, TotalPrice: 1000},
			},
		}))
		if updErr != nil {
			t.Fatalf("update to %d: %v", qty, updErr)
		}
	}

	// Re-read: an edit replaces the lines, so the item ids the count must name are the NEW ones.
	reread, err := svc.RestockRequestDetail(buyerCtx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: id,
	}))
	if err != nil {
		t.Fatalf("detail before accept: %v", err)
	}

	_, err = svc.RestockRequestFulfill(handCtx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: id, Lines: allArrived(reread.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	detail, err := svc.RestockRequestDetail(buyerCtx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: id,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	events := detail.Msg.GetRequest().GetEvents()

	wantKinds := []inventoryv1.RestockRequestEventKind{
		inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_CREATED,
		inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_EDITED,
		inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_EDITED,
		inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_ACCEPTED,
	}

	if len(events) != len(wantKinds) {
		t.Fatalf("history has %d events, want %d: %+v", len(events), len(wantKinds), events)
	}

	// ORDER IS THE POINT of a timeline, so it is asserted rather than the set being counted.
	for i := range wantKinds {
		if events[i].GetKind() != wantKinds[i] {
			t.Fatalf("event %d is %v, want %v", i, events[i].GetKind(), wantKinds[i])
		}

		if events[i].GetAtUnix() == 0 {
			t.Fatalf("event %d (%v) has no timestamp", i, events[i].GetKind())
		}
	}

	// WHO. The three the buyer did name the buyer; the acceptance names the warehouse hand — a handler
	// that took the actor from the row instead of the caller would put the buyer on all four.
	for i := 0; i < 3; i++ {
		if events[i].GetActorUserId() != buyer {
			t.Fatalf("event %d (%v) actor = %d, want the buyer %d",
				i, events[i].GetKind(), events[i].GetActorUserId(), buyer)
		}
	}

	if events[3].GetActorUserId() != warehouseHand {
		t.Fatalf("accepted event actor = %d, want the warehouse hand %d",
			events[3].GetActorUserId(), warehouseHand)
	}

	// The ACCEPTED event and the `accepted_at` column must name the same second, or the timeline and
	// the date filter disagree about when a delivery landed.
	if events[3].GetAtUnix() != detail.Msg.GetRequest().GetAcceptedAtUnix() {
		t.Fatalf("accepted event at %d but accepted_at is %d — the event and the column drifted",
			events[3].GetAtUnix(), detail.Msg.GetRequest().GetAcceptedAtUnix())
	}

	// ⚠ THE LIST MUST NOT CARRY THE HISTORY (see the proto): a page of restocks would pull every event
	// of each to render a table that shows none.
	for _, r := range listRestocks(t, svc, buyerCtx, sellingTeam, &inventoryv1.RestockRequestListFilter{}) {
		if len(r.GetEvents()) != 0 {
			t.Fatalf("list row #%d carries %d events; the list must not load them", r.GetId(), len(r.GetEvents()))
		}
	}
}

// Cancelling names a person now (00019) — it used to record only a date, so the timeline's cancelled
// step was the one step that could not say who.
func TestRestockRequest_CancelRecordsWho(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const sellingTeam, warehouse uint64 = 2, 5
	const buyer, colleague uint64 = 7, 8

	created, err := svc.RestockRequestCreate(ctxUser(buyer), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// A COLLEAGUE cancels it, not the author — which is the whole reason the column cannot be inferred
	// from `created_by_user_id`.
	cancelled, err := svc.RestockRequestCancel(ctxUser(colleague), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: sellingTeam, RequestId: created.Msg.GetRequest().GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	got := cancelled.Msg.GetRequest()

	if got.GetCancelledByUserId() != colleague {
		t.Fatalf("cancelled_by = %d, want the cancelling caller %d", got.GetCancelledByUserId(), colleague)
	}

	if got.GetCreatedByUserId() != buyer {
		t.Fatalf("created_by = %d after cancelling, want the original author %d",
			got.GetCreatedByUserId(), buyer)
	}

	detail, err := svc.RestockRequestDetail(ctxUser(buyer), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: created.Msg.GetRequest().GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	events := detail.Msg.GetRequest().GetEvents()
	last := events[len(events)-1]

	if last.GetKind() != inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_CANCELLED {
		t.Fatalf("last event is %v, want CANCELLED", last.GetKind())
	}

	if last.GetActorUserId() != colleague {
		t.Fatalf("cancelled event actor = %d, want %d", last.GetActorUserId(), colleague)
	}

	if last.GetAtUnix() != got.GetCancelledAtUnix() {
		t.Fatalf("cancelled event at %d but cancelled_at is %d — the event and the column drifted",
			last.GetAtUnix(), got.GetCancelledAtUnix())
	}
}
