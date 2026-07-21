package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"gorm.io/gorm"
)

const (
	pending   = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_PENDING
	fulfilled = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_FULFILLED
	cancelled = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED
)

// allArrived is the "everything turned up as asked, and went to the unplaced pile" count — what a test
// that is about neither a shortfall nor a shelf means when it accepts.
//
// Accepting is a COUNT (#133) that also says WHERE (#137), and neither has a shortcut: there is no
// "accept it as asked" and no "put it somewhere". So even the tests that do not care have to say both
// out loud — and "unplaced" is the honest answer for a test with no shelf in it, not a way of saying
// nothing.
func allArrived(r *inventoryv1.RestockRequest) []*inventoryv1.RestockRequestReceivedLine {
	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, len(r.GetItems()))
	for _, item := range r.GetItems() {
		lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
			ItemId:           item.GetId(),
			ReceivedQuantity: item.GetQuantity(),
			// One placement, the whole line, unplaced (#154). The list shape allows several; a test with
			// no shelf in it means all of it went to the same (un)place.
			Placements: []*inventoryv1.RestockPlacement{
				{
					Place:    &inventoryv1.RestockPlacement_Unplaced{Unplaced: true},
					Quantity: item.GetQuantity(),
				},
			},
		})
	}

	return lines
}

// onePlace is the count for a test that cares WHERE, but only about one shelf: everything arrived and
// all of it went to `rack` (nil = the unplaced pile).
func onePlace(r *inventoryv1.RestockRequest, rack *uint64) []*inventoryv1.RestockRequestReceivedLine {
	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, len(r.GetItems()))
	for _, item := range r.GetItems() {
		p := &inventoryv1.RestockPlacement{Quantity: item.GetQuantity()}

		if rack != nil {
			p.Place = &inventoryv1.RestockPlacement_RackId{RackId: *rack}
		} else {
			p.Place = &inventoryv1.RestockPlacement_Unplaced{Unplaced: true}
		}

		lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
			ItemId:           item.GetId(),
			ReceivedQuantity: item.GetQuantity(),
			Placements:       []*inventoryv1.RestockPlacement{p},
		})
	}

	return lines
}

func TestRestockRequest_CreateListFulfil(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 5000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Msg.GetRequest().GetStatus() != pending {
		t.Fatalf("new request status = %v, want PENDING", created.Msg.GetRequest().GetStatus())
	}
	reqID := created.Msg.GetRequest().GetId()

	// Both the requesting team and the target warehouse see the request.
	for _, team := range []uint64{sellingTeam, warehouse} {
		lst, listErr := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
			TeamId: team, Page: page1(),
		}))
		if listErr != nil {
			t.Fatalf("list team %d: %v", team, listErr)
		}
		if len(lst.Msg.GetRequests()) != 1 {
			t.Fatalf("team %d list = %d, want 1", team, len(lst.Msg.GetRequests()))
		}
	}

	// An unrelated team sees nothing.
	other, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{TeamId: 9, Page: page1()}))
	if err != nil {
		t.Fatalf("list other: %v", err)
	}
	if len(other.Msg.GetRequests()) != 0 {
		t.Fatalf("unrelated team should see 0 requests, got %d", len(other.Msg.GetRequests()))
	}

	// A non-target warehouse cannot fulfil it (reads as NotFound). The count is valid, so this proves
	// the SCOPE is what refuses it, not a malformed count.
	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: 9, RequestId: reqID, Lines: allArrived(created.Msg.GetRequest()),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-warehouse fulfil code = %v, want NotFound", connect.CodeOf(err))
	}

	// The target warehouse fulfils: status FULFILLED and the stock is received.
	ful, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: reqID, Lines: allArrived(created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}
	if ful.Msg.GetRequest().GetStatus() != fulfilled {
		t.Fatalf("status = %v, want FULFILLED", ful.Msg.GetRequest().GetStatus())
	}

	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{WarehouseId: warehouse, Page: page1()}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}
	if len(levels.Msg.GetLevels()) != 1 || levels.Msg.GetLevels()[0].GetOnHand() != 10 {
		t.Fatalf("on-hand after fulfil should be 10, got %+v", levels.Msg.GetLevels())
	}

	// Re-fulfilling a fulfilled request is rejected.
	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: reqID, Lines: allArrived(created.Msg.GetRequest()),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("re-fulfil code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// The list's tabs (#130): filter to one status, or all of them. Server-side, because the list is
// paginated — a client-side tab would filter one page and still report the unfiltered total.
func TestRestockRequestList_FilterByStatus(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	// Returns the whole request, not just its id: accepting one needs its LINES to count (#133).
	newRequest := func() *inventoryv1.RestockRequest {
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

	// One of each status: pending, fulfilled, cancelled.
	stillPending := newRequest()

	toFulfil := newRequest()
	_, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: toFulfil.GetId(), Lines: allArrived(toFulfil),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	toCancel := newRequest()
	_, err = svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: sellingTeam, RequestId: toCancel.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	list := func(team uint64, status inventoryv1.RestockRequestStatus) []*inventoryv1.RestockRequest {
		t.Helper()

		resp, listErr := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
			TeamId: team, Page: page1(), Status: status,
		}))
		if listErr != nil {
			t.Fatalf("list: %v", listErr)
		}

		return resp.Msg.GetRequests()
	}

	// UNSPECIFIED is the "All Status" tab.
	if all := list(sellingTeam, inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED); len(all) != 3 {
		t.Fatalf("all-status tab = %d, want 3", len(all))
	}

	// Each status tab returns only its own.
	onlyPending := list(sellingTeam, pending)
	if len(onlyPending) != 1 || onlyPending[0].GetId() != stillPending.GetId() {
		t.Fatalf("pending tab = %+v, want just the pending one", onlyPending)
	}

	if only := list(sellingTeam, fulfilled); len(only) != 1 || only[0].GetId() != toFulfil.GetId() {
		t.Fatalf("fulfilled tab = %+v", only)
	}

	if only := list(sellingTeam, cancelled); len(only) != 1 || only[0].GetId() != toCancel.GetId() {
		t.Fatalf("cancelled tab = %+v", only)
	}

	// The WAREHOUSE side sees the same requests through its own leg of the OR, and the tab must
	// filter that leg too. This is what catches the operator-precedence trap: an unparenthesised
	// `requesting_team_id = ? OR warehouse_id = ? AND status = ?` binds the AND to the warehouse leg
	// only, so the selling team's list would quietly ignore the tab.
	if only := list(warehouse, pending); len(only) != 1 || only[0].GetId() != stillPending.GetId() {
		t.Fatalf("warehouse pending tab = %+v, want just the pending one", only)
	}

	// And the counts must be the FILTERED totals, or the pager lies.
	resp, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: sellingTeam, Page: page1(), Status: pending,
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("pending total = %d, want 1 (the pager must count the FILTERED set)",
			resp.Msg.GetPageInfo().GetTotalItems())
	}
}

// The detail page's read (#125): BOTH sides can open a request in full, with its lines; anyone else
// gets NotFound rather than a permission error that would confirm the id exists.
func TestRestockRequest_Detail(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ShippingCode: "jne", Receipt: "JP99",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2, TotalPrice: 1500},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Quantity: 5, TotalPrice: 700},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reqID := created.Msg.GetRequest().GetId()

	// The requester and the target warehouse both see it, lines and all.
	for _, team := range []uint64{sellingTeam, warehouse} {
		resp, detailErr := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
			TeamId: team, RequestId: reqID,
		}))
		if detailErr != nil {
			t.Fatalf("detail as team %d: %v", team, detailErr)
		}

		got := resp.Msg.GetRequest()
		if len(got.GetItems()) != 2 {
			t.Fatalf("team %d: items = %d, want 2", team, len(got.GetItems()))
		}
		if got.GetReceipt() != "JP99" || got.GetItems()[1].GetTotalPrice() != 700 {
			t.Fatalf("team %d: detail did not round-trip: %+v", team, got)
		}
	}

	// A team on neither side of it cannot read it.
	_, err = svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: 9, RequestId: reqID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("outsider detail code = %v, want NotFound", connect.CodeOf(err))
	}

	// An id that does not exist is the same NotFound.
	_, err = svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: 999999,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("unknown id code = %v, want NotFound", connect.CodeOf(err))
	}
}

// The restock's own money and context (#127): a free-text order REFERENCE (not an id — it names an
// order in someone else's system), what the freight cost, how it was paid, and a note.
func TestRestockRequest_OrderRefPaymentAndNote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: 5, ShippingCode: "jne",
		// Deliberately NOT numeric: the reference is whatever the marketplace calls it, and the old
		// uint64 could not hold this at all.
		OrderRef:     "SHP-2026-ABC/01",
		ShippingCost: 18000,
		PaymentType:  inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_SHOPEE_PAY,
		Note:         "titip ke driver, jangan ditinggal di pos",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 3, TotalPrice: 4000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got := created.Msg.GetRequest()
	if got.GetOrderRef() != "SHP-2026-ABC/01" {
		t.Fatalf("order ref = %q, want the non-numeric reference back", got.GetOrderRef())
	}
	if got.GetShippingCost() != 18000 {
		t.Fatalf("shipping cost = %d, want 18000", got.GetShippingCost())
	}
	if got.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_SHOPEE_PAY {
		t.Fatalf("payment type = %v, want SHOPEE_PAY", got.GetPaymentType())
	}
	if got.GetNote() != "titip ke driver, jangan ditinggal di pos" {
		t.Fatalf("note did not round-trip: %q", got.GetNote())
	}

	// It survives the DB round trip too — the enum is stored as text, so a broken mapper would only
	// show up on the way back out.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: 2, RequestId: got.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	back := detail.Msg.GetRequest()
	if back.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_SHOPEE_PAY ||
		back.GetOrderRef() != "SHP-2026-ABC/01" || back.GetShippingCost() != 18000 {
		t.Fatalf("context did not survive the round trip: %+v", back)
	}
}

// None of #127's context is required: no order, no freight, no payment type, no note is a perfectly
// good request. An unset payment type comes back UNSPECIFIED, not a guess.
func TestRestockRequest_PaymentContextOptional(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create without #127 context: %v", err)
	}

	got := created.Msg.GetRequest()
	if got.GetOrderRef() != "" || got.GetShippingCost() != 0 || got.GetNote() != "" {
		t.Fatalf("absent context should be zero, got %+v", got)
	}
	if got.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_UNSPECIFIED {
		t.Fatalf("payment type = %v, want UNSPECIFIED", got.GetPaymentType())
	}
}

// A request carries MANY priced lines, and fulfilling it receives EVERY one of them (#124).
func TestRestockRequest_MultipleItemsAllReceived(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 4, TotalPrice: 5000},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Quantity: 7, TotalPrice: 12500},
			// Price 0 is legitimate — a transfer or a sample, not a mistake.
			{ProductId: 300, Sku: "SKU3", Name: "Freebie", Quantity: 1},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got := created.Msg.GetRequest()
	if len(got.GetItems()) != 3 {
		t.Fatalf("items = %d, want 3", len(got.GetItems()))
	}
	if got.GetItems()[1].GetTotalPrice() != 12500 || got.GetItems()[1].GetSku() != "SKU2" {
		t.Fatalf("line did not round-trip: %+v", got.GetItems()[1])
	}

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: got.GetId(), Lines: allArrived(got),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	// Every line landed as its own on-hand.
	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	onHand := map[uint64]int64{}
	for _, l := range levels.Msg.GetLevels() {
		onHand[l.GetProductId()] = l.GetOnHand()
	}

	if onHand[100] != 4 || onHand[200] != 7 || onHand[300] != 1 {
		t.Fatalf("every line should be received, got %+v", onHand)
	}
}

// The optional supplier must be one of the REQUESTING team's own — another team's reads as NotFound,
// so the error cannot be used to confirm that an id exists (#124).
func TestRestockRequest_SupplierMustBelongToRequester(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	mine := insertSupplier(t, db, sellingTeam, "My Vendor", "V-MINE")
	theirs := insertSupplier(t, db, 9, "Their Vendor", "V-THEIRS")

	create := func(supplierID uint64) error {
		_, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: 5, SupplierId: supplierID,
			OrderRef: "SHP-77", Receipt: "JP1234567890",
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
			},
		}))

		return err
	}

	// Our own supplier is fine, and the optional context round-trips.
	resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5, SupplierId: mine,
		OrderRef: "SHP-77", Receipt: "JP1234567890",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create with own supplier: %v", err)
	}
	if got := resp.Msg.GetRequest(); got.GetSupplierId() != mine || got.GetOrderRef() != "SHP-77" ||
		got.GetReceipt() != "JP1234567890" {
		t.Fatalf("optional context did not round-trip: %+v", got)
	}

	// Another team's supplier is NotFound.
	if code := connect.CodeOf(create(theirs)); code != connect.CodeNotFound {
		t.Fatalf("cross-team supplier code = %v, want NotFound", code)
	}

	// An id that exists nowhere is the same NotFound — indistinguishable, on purpose.
	if code := connect.CodeOf(create(999999)); code != connect.CodeNotFound {
		t.Fatalf("unknown supplier code = %v, want NotFound", code)
	}
}

// No supplier / order / receipt at all is a perfectly good request — all three are optional.
func TestRestockRequest_OptionalContextOmitted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2, TotalPrice: 900},
		},
	}))
	if err != nil {
		t.Fatalf("create without optional context: %v", err)
	}

	got := created.Msg.GetRequest()
	if got.GetSupplierId() != 0 || got.GetOrderRef() != "" || got.GetReceipt() != "" {
		t.Fatalf("absent context should be zero, got %+v", got)
	}
}

// #133 — the heart of it: STOCK RECEIVES WHAT WAS COUNTED, never what was asked for. A request is a
// promise; the delivery is a fact, and receiving the promise would be inventing stock the warehouse
// does not have.
func TestRestockRequest_FulfilReceivesWhatArrivedNotWhatWasAsked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Short", Quantity: 10, TotalPrice: 5000},
			{ProductId: 200, Sku: "SKU2", Name: "Exact", Quantity: 3, TotalPrice: 1000},
			{ProductId: 300, Sku: "SKU3", Name: "Over", Quantity: 5, TotalPrice: 200},
			{ProductId: 400, Sku: "SKU4", Name: "Missing", Quantity: 2, TotalPrice: 900},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	items := req.GetItems()

	shelf := insertRack(t, db, warehouse, "A-01-3")

	// The four things a delivery can do to a line: come up short, match, over-deliver, not turn up.
	// Each that ARRIVED also says where it went (#137); the one that never turned up names no place,
	// because there is nowhere to put goods that are not there.
	onShelf := func(id uint64, qty int64) *inventoryv1.RestockRequestReceivedLine {
		return &inventoryv1.RestockRequestReceivedLine{
			ItemId: id, ReceivedQuantity: qty,
			Placements: placedOn(shelf, qty),
		}
	}

	ful, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			onShelf(items[0].GetId(), 9),
			onShelf(items[1].GetId(), 3),
			onShelf(items[2].GetId(), 6),
			{ItemId: items[3].GetId(), ReceivedQuantity: 0},
		},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	// A short count still FULFILS: the delivery happened, and the request has done its job.
	if ful.Msg.GetRequest().GetStatus() != fulfilled {
		t.Fatalf("a short delivery still fulfils, got %v", ful.Msg.GetRequest().GetStatus())
	}

	// BOTH numbers survive — the gap is the record's whole point.
	//
	// Read back through Detail, which is a FRESH DB read. Asserting this on the fulfil RESPONSE would
	// prove nothing: the response is built by restockRequestToProto(&rr) from the very struct the
	// handler assigns in memory, so it reports the count whether or not the column was ever written.
	// Only a re-read witnesses persistence — without this, deleting the handler's received_quantity
	// UPDATE leaves every test in this file green while the row keeps its DEFAULT 0.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: req.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	got := detail.Msg.GetRequest().GetItems()
	for i, want := range []struct{ asked, arrived int64 }{{10, 9}, {3, 3}, {5, 6}, {2, 0}} {
		if got[i].GetQuantity() != want.asked || got[i].GetReceivedQuantity() != want.arrived {
			t.Fatalf("line %d AS STORED: asked=%d arrived=%d, want asked=%d arrived=%d",
				i, got[i].GetQuantity(), got[i].GetReceivedQuantity(), want.asked, want.arrived)
		}
	}

	// And the response must AGREE with the row — it is what the screen renders the instant the dialog
	// closes, so a response that flatters the stored truth would be a lie with a short shelf life.
	for i, item := range ful.Msg.GetRequest().GetItems() {
		if item.GetReceivedQuantity() != got[i].GetReceivedQuantity() {
			t.Fatalf("line %d: the response says %d arrived, the stored row says %d",
				i, item.GetReceivedQuantity(), got[i].GetReceivedQuantity())
		}
	}

	// Stock holds what was COUNTED. The line that never turned up holds nothing at all — not a zero
	// row, because "received none" and "never received" must not read the same.
	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	onHand := map[uint64]int64{}
	for _, lvl := range levels.Msg.GetLevels() {
		onHand[lvl.GetProductId()] = lvl.GetOnHand()
	}

	for product, want := range map[uint64]int64{100: 9, 200: 3, 300: 6} {
		if onHand[product] != want {
			t.Fatalf("product %d on-hand = %d, want %d (the COUNT, not the ask)", product, onHand[product], want)
		}
	}

	if _, present := onHand[400]; present {
		t.Fatalf("a line that never arrived must not create a stock level, got %+v", levels.Msg.GetLevels())
	}
}

// #137 — counting and shelving are ONE act: the goods land on the shelf the warehouse NAMED, not in an
// unplaced pile someone has to work through afterwards.
func TestRestockRequest_FulfilPutsGoodsOnTheNamedShelf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rackA := insertRack(t, db, warehouse, "A-01-3")
	rackB := insertRack(t, db, warehouse, "A-02-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 500},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Quantity: 4, TotalPrice: 700},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	items := req.GetItems()

	// Two lines, two different shelves — a delivery does not all go to one place.
	ful, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: items[0].GetId(), ReceivedQuantity: 10, Placements: placedOn(rackA, 10)},
			{ItemId: items[1].GetId(), ReceivedQuantity: 4, Placements: placedOn(rackB, 4)},
		},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	// The request remembers where each line was put.
	for i, want := range []uint64{rackA, rackB} {
		places := ful.Msg.GetRequest().GetItems()[i].GetPlacements()
		if len(places) != 1 {
			t.Fatalf("line %d recorded %d placements, want 1", i, len(places))
		}
		if got := places[0].GetRackId(); got != want {
			t.Fatalf("line %d recorded rack %d, want %d", i, got, want)
		}
	}

	// The stock is ON those shelves — and nothing landed unplaced, which is the whole point of
	// shelving as you count.
	for _, c := range []struct {
		product uint64
		rack    uint64
		want    int64
	}{{100, rackA, 10}, {200, rackB, 4}} {
		var on int64

		err = db.Raw(`SELECT COALESCE(SUM(on_hand), 0) FROM stock_levels
		              WHERE warehouse_id = ? AND product_id = ? AND rack_id = ?`,
			warehouse, c.product, c.rack).Scan(&on).Error
		if err != nil {
			t.Fatalf("read shelf: %v", err)
		}

		if on != c.want {
			t.Fatalf("product %d on rack %d = %d, want %d", c.product, c.rack, on, c.want)
		}
	}

	var unplacedRows int64

	err = db.Raw(`SELECT COUNT(*) FROM stock_levels WHERE warehouse_id = ? AND rack_id IS NULL`,
		warehouse).Scan(&unplacedRows).Error
	if err != nil {
		t.Fatalf("count unplaced: %v", err)
	}

	if unplacedRows != 0 {
		t.Fatalf("shelving as you count must leave nothing unplaced, got %d unplaced rows", unplacedRows)
	}

	// And the ledger says which shelf each receipt went to.
	var placedMovements int64

	err = db.Raw(`SELECT COUNT(*) FROM stock_movements WHERE warehouse_id = ? AND rack_id IS NOT NULL`,
		warehouse).Scan(&placedMovements).Error
	if err != nil {
		t.Fatalf("count movements: %v", err)
	}

	if placedMovements != 2 {
		t.Fatalf("both receipts must name their shelf in the ledger, got %d placed", placedMovements)
	}
}

// #137 — goods that ARRIVED are somewhere, so the warehouse must say where. Silence is refused, never
// read as "unplaced": guessing a place for real goods is how stock ends up somewhere nobody looked.
// A line that did NOT arrive owes no place — there is nothing to put anywhere.
func TestRestockRequest_FulfilRefusesArrivedGoodsWithNoPlace(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	create := func() *inventoryv1.RestockRequest {
		t.Helper()

		created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 3, TotalPrice: 500},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return created.Msg.GetRequest()
	}

	// Arrived, but no place named → refused.
	req := create()

	_, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: req.GetItems()[0].GetId(), ReceivedQuantity: 3},
		},
	}))
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("arrived goods with no place = %v, want InvalidArgument", code)
	}

	// Nothing moved — a refused acceptance must leave the request acceptable.
	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}
	if len(levels.Msg.GetLevels()) != 0 {
		t.Fatalf("a refused acceptance must move no stock, got %+v", levels.Msg.GetLevels())
	}

	// A line that did NOT arrive owes no place — nothing is there to put anywhere.
	nothingCame := create()

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: nothingCame.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: nothingCame.GetItems()[0].GetId(), ReceivedQuantity: 0},
		},
	}))
	if err != nil {
		t.Fatalf("a line that never turned up owes no place, got: %v", err)
	}
}

// #137 — the shelf must belong to the ACCEPTING warehouse. Another warehouse's rack reads as NotFound,
// never PermissionDenied: a permission error would confirm the id exists.
func TestRestockRequest_FulfilCrossWarehouseRackIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse, otherWarehouse uint64 = 2, 5, 6

	theirShelf := insertRack(t, db, otherWarehouse, "B-01-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 3, TotalPrice: 500},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	for name, rack := range map[string]uint64{
		"another warehouse's shelf":   theirShelf,
		"a shelf that exists nowhere": 999999,
	} {
		_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
			TeamId: warehouse, RequestId: req.GetId(),
			Lines: []*inventoryv1.RestockRequestReceivedLine{
				{
					ItemId: req.GetItems()[0].GetId(), ReceivedQuantity: 3,
					Placements: placedOn(rack, 3),
				},
			},
		}))
		if code := connect.CodeOf(err); code != connect.CodeNotFound {
			t.Fatalf("%s = %v, want NotFound", name, code)
		}
	}
}

// received_quantity rides the SHARED line message (a line reads back what arrived), so create and edit
// can both be TOLD one — and must both ignore it. Only the warehouse writes it, and only by counting.
// Honouring it here would let the requesting team declare its own delivery received: stock the
// warehouse never saw, written by the party that benefits from claiming it turned up (#133).
func TestRestockRequest_RequesterCannotDeclareItsOwnDeliveryReceived(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	// A shelf in the warehouse the requester is asking — it knows the id, and that must not help.
	shelf := insertRack(t, db, warehouse, "A-01-3")

	// The requester claims 10 already arrived AND that they are on a shelf, at create time.
	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{
				ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 500,
				ReceivedQuantity: 10,
				Placements:       placedOn(shelf, 10),
				// And writes off two of its own goods while it is at it (#154).
				Damaged: []*inventoryv1.RestockDamagedUnits{
					{Quantity: 2, Reason: "claimed by the requester", Value: 100},
				},
			},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	if got := req.GetItems()[0].GetReceivedQuantity(); got != 0 {
		t.Fatalf("create honoured a claimed receipt: received = %d, want 0", got)
	}
	if got := req.GetItems()[0].GetPlacements(); len(got) != 0 {
		t.Fatalf("create honoured a claimed SHELF: placements = %v, want none (#137/#154)", got)
	}
	if got := req.GetItems()[0].GetDamaged(); len(got) != 0 {
		t.Fatalf("create honoured a claimed WRITE-OFF: damaged = %v, want none (#154)", got)
	}

	// And again on edit.
	updated, err := svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: req.GetId(), WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{
				ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 500,
				ReceivedQuantity: 10,
				Placements:       placedOn(shelf, 10),
				// And writes off two of its own goods while it is at it (#154).
				Damaged: []*inventoryv1.RestockDamagedUnits{
					{Quantity: 2, Reason: "claimed by the requester", Value: 100},
				},
			},
		},
	}))
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := updated.Msg.GetRequest().GetItems()[0].GetReceivedQuantity(); got != 0 {
		t.Fatalf("edit honoured a claimed receipt: received = %d, want 0", got)
	}
	if got := updated.Msg.GetRequest().GetItems()[0].GetPlacements(); len(got) != 0 {
		t.Fatalf("edit honoured a claimed SHELF: placements = %v, want none (#137/#154)", got)
	}
	if got := updated.Msg.GetRequest().GetItems()[0].GetDamaged(); len(got) != 0 {
		t.Fatalf("edit honoured a claimed WRITE-OFF: damaged = %v, want none (#154)", got)
	}

	// Nothing reached stock, either — the claim moved no goods.
	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}
	if len(levels.Msg.GetLevels()) != 0 {
		t.Fatalf("a claimed receipt must move no stock, got %+v", levels.Msg.GetLevels())
	}
}

// Accepting IS the count (#133), so a count that does not cover the request exactly is refused rather
// than interpreted: reading an omitted line as "all of it came" or "none did" is a guess, and a guess
// about stock is drift.
func TestRestockRequest_FulfilRefusesAnIncompleteCount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 4, TotalPrice: 500},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Quantity: 6, TotalPrice: 700},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	items := req.GetItems()

	tryCount := func(lines []*inventoryv1.RestockRequestReceivedLine) error {
		_, fulErr := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
			TeamId: warehouse, RequestId: req.GetId(), Lines: lines,
		}))

		return fulErr
	}

	cases := map[string][]*inventoryv1.RestockRequestReceivedLine{
		"a line left uncounted": {
			{ItemId: items[0].GetId(), ReceivedQuantity: 4},
		},
		"the same line counted twice": {
			{ItemId: items[0].GetId(), ReceivedQuantity: 4},
			{ItemId: items[0].GetId(), ReceivedQuantity: 4},
		},
		"a line that is not on this request": {
			{ItemId: items[0].GetId(), ReceivedQuantity: 4},
			{ItemId: 999999, ReceivedQuantity: 6},
		},
	}

	for name, lines := range cases {
		if code := connect.CodeOf(tryCount(lines)); code != connect.CodeInvalidArgument {
			t.Fatalf("%s: code = %v, want InvalidArgument", name, code)
		}
	}

	// Every refusal left the request untouched — no stock moved, and it is still acceptable.
	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}
	if len(levels.Msg.GetLevels()) != 0 {
		t.Fatalf("a refused count must move no stock, got %+v", levels.Msg.GetLevels())
	}

	if err = tryCount(allArrived(req)); err != nil {
		t.Fatalf("a complete count must still be accepted afterwards: %v", err)
	}
}

// #131: while the warehouse has not accepted it, a request is freely edited — every field, lines
// included. The lines are REPLACED, not merged: sending two lines over one leaves exactly the two.
func TestRestockRequest_Update(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse, otherWarehouse uint64 = 2, 5, 6

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 5000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	edit := &inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: reqID,
		// Even the warehouse may change: nothing has been accepted, so nothing is committed to it.
		WarehouseId: otherWarehouse, ShippingCode: "sicepat",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Quantity: 3, TotalPrice: 1500},
			{ProductId: 300, Sku: "SKU3", Name: "Gizmo", Quantity: 7, TotalPrice: 250},
		},
		Receipt: "SC9999", OrderRef: "SHP-42", ShippingCost: 12000,
		PaymentType: inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_BANK_ACCOUNT,
		Note:        "edited before the warehouse took it",
	}

	// Another team cannot edit it — indistinguishable from one that does not exist.
	_, err = svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: 9, RequestId: reqID, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: 1, Sku: "X", Name: "X", Quantity: 1}},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team update code = %v, want NotFound", connect.CodeOf(err))
	}

	updated, err := svc.RestockRequestUpdate(ctx, connect.NewRequest(edit))
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	got := updated.Msg.GetRequest()
	if got.GetStatus() != pending {
		t.Fatalf("an edit must not move the status: got %v, want PENDING", got.GetStatus())
	}
	if got.GetWarehouseId() != otherWarehouse || got.GetShippingCode() != "sicepat" ||
		got.GetReceipt() != "SC9999" || got.GetOrderRef() != "SHP-42" ||
		got.GetShippingCost() != 12000 || got.GetNote() != "edited before the warehouse took it" ||
		got.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_BANK_ACCOUNT {
		t.Fatalf("edit did not round-trip: %+v", got)
	}

	// Read it back rather than trusting the response — the rows are what the next reader sees.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: reqID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	items := detail.Msg.GetRequest().GetItems()
	if len(items) != 2 {
		t.Fatalf("lines are replaced, not merged: got %d lines, want 2 (%+v)", len(items), items)
	}
	if items[0].GetSku() != "SKU2" || items[0].GetQuantity() != 3 || items[0].GetTotalPrice() != 1500 ||
		items[1].GetSku() != "SKU3" || items[1].GetQuantity() != 7 {
		t.Fatalf("replaced lines wrong: %+v", items)
	}

	// The warehouse it MOVED TO can see it; the one it moved off can no longer.
	for team, want := range map[uint64]int{otherWarehouse: 1, warehouse: 0} {
		lst, listErr := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
			TeamId: team, Page: page1(),
		}))
		if listErr != nil {
			t.Fatalf("list team %d: %v", team, listErr)
		}
		if len(lst.Msg.GetRequests()) != want {
			t.Fatalf("team %d sees %d requests, want %d", team, len(lst.Msg.GetRequests()), want)
		}
	}
}

// An edit is a full REPLACE, so emptying a field CLEARS it. This is the case a struct-based
// Updates() would silently drop (GORM skips a struct's zero values) — leaving the old note and
// supplier in place while the form showed them gone.
func TestRestockRequest_UpdateClearsOptionalContext(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	supplier := insertSupplier(t, db, sellingTeam, "My Vendor", "V-MINE")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5, ShippingCode: "jne",
		SupplierId: supplier, OrderRef: "SHP-1", Receipt: "JP1", ShippingCost: 9000,
		PaymentType: inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_SHOPEE_PAY,
		Note:        "please hurry",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	// Everything optional left out: the person cleared the lot.
	_, err = svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: reqID, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: reqID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	got := detail.Msg.GetRequest()
	if got.GetSupplierId() != 0 || got.GetOrderRef() != "" || got.GetReceipt() != "" ||
		got.GetShippingCost() != 0 || got.GetNote() != "" || got.GetShippingCode() != "" ||
		got.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_UNSPECIFIED {
		t.Fatalf("cleared fields were kept: %+v", got)
	}
}

// "when restock not accepted by warehouse. its freely edited" (#131) — the converse is the guard:
// once it is accepted (or cancelled), it is not editable at all.
func TestRestockRequest_UpdateOnlyWhilePending(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	newPending := func() *inventoryv1.RestockRequest {
		t.Helper()

		created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 4, TotalPrice: 500},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		// The whole request, not just its id: accepting one needs its lines to count (#133).
		return created.Msg.GetRequest()
	}

	tryEdit := func(reqID uint64) error {
		_, err := svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
			TeamId: sellingTeam, RequestId: reqID, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 999, TotalPrice: 500},
			},
		}))

		return err
	}

	// Accepted by the warehouse: the goods have moved, so the record is history.
	accepted := newPending()

	_, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: accepted.GetId(), Lines: allArrived(accepted),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	if code := connect.CodeOf(tryEdit(accepted.GetId())); code != connect.CodeFailedPrecondition {
		t.Fatalf("editing an accepted request = %v, want FailedPrecondition", code)
	}

	// Cancelled: closed, and re-opening it by editing would hide that it ever was.
	dropped := newPending()

	_, err = svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: sellingTeam, RequestId: dropped.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if code := connect.CodeOf(tryEdit(dropped.GetId())); code != connect.CodeFailedPrecondition {
		t.Fatalf("editing a cancelled request = %v, want FailedPrecondition", code)
	}

	// The refused edit changed nothing — the accepted request still reads as it was received.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: accepted.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if qty := detail.Msg.GetRequest().GetItems()[0].GetQuantity(); qty != 4 {
		t.Fatalf("refused edit still wrote: quantity = %d, want 4", qty)
	}
}

// The supplier rule holds on edit exactly as on create: it must be one of the REQUESTING team's own,
// or the id itself would confirm another team's vendor.
func TestRestockRequest_UpdateSupplierMustBelongToRequester(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	mine := insertSupplier(t, db, sellingTeam, "My Vendor", "V-MINE")
	theirs := insertSupplier(t, db, 9, "Their Vendor", "V-THEIRS")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	edit := func(supplierID uint64) error {
		_, updErr := svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
			TeamId: sellingTeam, RequestId: reqID, WarehouseId: 5, SupplierId: supplierID,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
			},
		}))

		return updErr
	}

	if err = edit(mine); err != nil {
		t.Fatalf("edit to own supplier: %v", err)
	}

	if code := connect.CodeOf(edit(theirs)); code != connect.CodeNotFound {
		t.Fatalf("cross-team supplier on edit = %v, want NotFound", code)
	}

	// The rejected edit must not have half-applied — the supplier is still ours.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: reqID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if got := detail.Msg.GetRequest().GetSupplierId(); got != mine {
		t.Fatalf("supplier after rejected edit = %d, want %d", got, mine)
	}
}

// Deleting a supplier must not brick the pending requests that already name it. Because an edit is a
// full replace, the form re-sends the supplier it prefilled — so re-validating an UNCHANGED id would
// reject the edit over a field the person never touched, and SupplierDelete is a soft delete, so the
// id keeps resolving to a row that supplierExists() refuses.
func TestRestockRequest_UpdateKeepsDeletedSupplierItAlreadyHad(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam uint64 = 2

	supplier := insertSupplier(t, db, sellingTeam, "Doomed Vendor", "V-DOOM")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5, SupplierId: supplier,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	_, err = svc.SupplierDelete(ctx, connect.NewRequest(&inventoryv1.SupplierDeleteRequest{
		TeamId: sellingTeam, SupplierId: supplier,
	}))
	if err != nil {
		t.Fatalf("delete supplier: %v", err)
	}

	// The edit re-sends the prefilled (now deleted) supplier and changes only the note.
	_, err = svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: reqID, WarehouseId: 5, SupplierId: supplier,
		Note: "just fixing a typo",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("editing a request whose supplier was deleted must still work, got: %v", err)
	}

	// But POINTING a request at a deleted supplier it did not already have is still refused.
	fresh, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create fresh: %v", err)
	}

	_, err = svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: fresh.Msg.GetRequest().GetId(), WarehouseId: 5,
		SupplierId: supplier,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, TotalPrice: 100},
		},
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("adopting a deleted supplier = %v, want NotFound", code)
	}
}

func TestRestockRequest_Cancel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "S", Name: "N", Quantity: 3},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	// Another team cannot cancel it.
	_, err = svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{TeamId: 9, RequestId: reqID}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team cancel code = %v, want NotFound", connect.CodeOf(err))
	}

	// The requester cancels a pending request.
	c, err := svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{TeamId: 2, RequestId: reqID}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if c.Msg.GetRequest().GetStatus() != cancelled {
		t.Fatalf("status = %v, want CANCELLED", c.Msg.GetRequest().GetStatus())
	}

	// Cancelling a non-pending request is rejected.
	_, err = svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{TeamId: 2, RequestId: reqID}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("re-cancel code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// placedOn is the ordinary single-placement case: all of it went to one shelf (#154). Named apart from
// stock_move_test.go's onRack, which builds a StockPlace for a different RPC.
func placedOn(rack uint64, qty int64) []*inventoryv1.RestockPlacement {
	return []*inventoryv1.RestockPlacement{
		{Place: &inventoryv1.RestockPlacement_RackId{RackId: rack}, Quantity: qty},
	}
}

// #154 — A DELIVERY OF 100 DOES NOT GO ON ONE SHELF. A line's goods can be split across several
// places, and each split is its own ledger row rather than one row averaging a location the goods
// never sat in.
func TestRestockRequest_FulfilSplitsALineAcrossSeveralShelves(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rackA := insertRack(t, db, warehouse, "A-01-1")
	rackB := insertRack(t, db, warehouse, "B-02-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 100, TotalPrice: 1000000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	// 100 arrived: 60 on A, 30 on B, and 10 not shelved yet — a real, ordinary put-away.
	ful, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: req.GetItems()[0].GetId(), ReceivedQuantity: 100,
				Placements: []*inventoryv1.RestockPlacement{
					{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackA}, Quantity: 60},
					{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackB}, Quantity: 30},
					{Place: &inventoryv1.RestockPlacement_Unplaced{Unplaced: true}, Quantity: 10},
				},
			},
		},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	places := ful.Msg.GetRequest().GetItems()[0].GetPlacements()
	if len(places) != 3 {
		t.Fatalf("recorded %d placements, want 3: %v", len(places), places)
	}

	// The stock is where it was actually put — checked per shelf, because a total alone would pass
	// even if all 100 had landed in one place.
	for _, want := range []struct {
		rack *uint64
		qty  int64
	}{{&rackA, 60}, {&rackB, 30}, {nil, 10}} {
		got := onHandAt(t, db, warehouse, 100, want.rack)
		if got != want.qty {
			label := "unplaced"
			if want.rack != nil {
				label = "a rack"
			}

			t.Fatalf("%s holds %d, want %d", label, got, want.qty)
		}
	}
}

// #154 — the placements must ADD UP to the count beside them.
//
// Somebody who says "8 arrived" and then puts 7 away has made a mistake in one of the two, and which
// one is not knowable from here. Refused, never interpreted — the same rule as an incomplete count
// (#133). Guessing would put the difference somewhere nobody chose.
func TestRestockRequest_FulfilRefusesPlacementsThatDoNotAddUp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rack := insertRack(t, db, warehouse, "A-01-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 50000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	for name, placements := range map[string][]*inventoryv1.RestockPlacement{
		"placed less than counted": {
			{Place: &inventoryv1.RestockPlacement_RackId{RackId: rack}, Quantity: 7},
		},
		"placed more than counted": {
			{Place: &inventoryv1.RestockPlacement_RackId{RackId: rack}, Quantity: 9},
		},
	} {
		_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
			TeamId: warehouse, RequestId: req.GetId(),
			Lines: []*inventoryv1.RestockRequestReceivedLine{
				{ItemId: req.GetItems()[0].GetId(), ReceivedQuantity: 8, Placements: placements},
			},
		}))
		if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
			t.Fatalf("%s = %v, want InvalidArgument", name, code)
		}
	}

	// The same shelf twice is refused too: that is one placement written down twice, and adding them
	// together is not the same as the person having meant it.
	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: req.GetItems()[0].GetId(), ReceivedQuantity: 8,
				Placements: []*inventoryv1.RestockPlacement{
					{Place: &inventoryv1.RestockPlacement_RackId{RackId: rack}, Quantity: 5},
					{Place: &inventoryv1.RestockPlacement_RackId{RackId: rack}, Quantity: 3},
				},
			},
		},
	}))
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("the same shelf twice = %v, want InvalidArgument", code)
	}
}

// #154 — BROKEN UNITS NEVER ENTER STOCK (owner, 2026-07-20).
//
// 10 arrived and 2 are crushed: 8 are sellable and 8 is what stock hears about. The 2 are recorded
// with their reason and value so the loss is a number somebody can total, but they are never on-hand —
// stock that cannot be sold is stock that fails at the shelf, in front of a customer.
func TestRestockRequest_FulfilRecordsDamageWithoutStockingIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rack := insertRack(t, db, warehouse, "A-01-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 100000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	ful, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: req.GetItems()[0].GetId(),
				// SELLABLE, not "arrived": 10 turned up, 2 of them broken.
				ReceivedQuantity: 8,
				Placements:       placedOn(rack, 8),
				Damaged: []*inventoryv1.RestockDamagedUnits{
					{Quantity: 2, Reason: "crushed in transit", Value: 20000},
				},
			},
		},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	item := ful.Msg.GetRequest().GetItems()[0]

	if got := item.GetReceivedQuantity(); got != 8 {
		t.Fatalf("received = %d, want 8 — the sellable count", got)
	}

	damaged := item.GetDamaged()
	if len(damaged) != 1 {
		t.Fatalf("recorded %d damage rows, want 1", len(damaged))
	}
	if damaged[0].GetQuantity() != 2 || damaged[0].GetValue() != 20000 {
		t.Fatalf("damage row = %+v, want 2 units worth 20000", damaged[0])
	}
	if damaged[0].GetReason() == "" {
		t.Fatal("the reason was dropped — a loss with no reason is a number nobody can act on")
	}

	// 8 ON THE SHELF, NOT 10. This is the assertion the whole decision rests on: the broken pair must
	// not be pickable.
	if got := onHandAt(t, db, warehouse, 100, &rack); got != 8 {
		t.Fatalf("the shelf holds %d, want 8 — the damaged units entered stock", got)
	}
}

// onHandAt reads what one PLACE holds. `rack == nil` is the unplaced pile, and IS NOT DISTINCT FROM is
// what makes that work: `rack_id = NULL` is never true in SQL, so the ordinary comparison would report
// the pile as empty however much sits in it (#135).
func onHandAt(t *testing.T, db *gorm.DB, warehouse, product uint64, rack *uint64) int64 {
	t.Helper()

	var on int64

	err := db.Raw(`SELECT COALESCE(SUM(on_hand), 0) FROM stock_levels
	               WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM ?`,
		warehouse, product, rack).Scan(&on).Error
	if err != nil {
		t.Fatalf("read place: %v", err)
	}

	return on
}

// #159 — narrow the restock list to ONE PRODUCT: "when did this warehouse last restock this".
//
// EXISTS rather than a join, for the same reason as OrderList: a request listing the same product on
// two lines must appear ONCE, and a join against the lines would return it per matching line and
// inflate the paginated count with it.
func TestRestockRequestList_FiltersByProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5
	const wanted, other uint64 = 100, 200

	// A request naming the product TWICE, alongside one that does not name it at all.
	twice, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: wanted, Sku: "SKU1", Name: "Widget", Quantity: 3, TotalPrice: 3000},
			{ProductId: wanted, Sku: "SKU1", Name: "Widget", Quantity: 2, TotalPrice: 2000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: other, Sku: "SKU2", Name: "Gadget", Quantity: 1, TotalPrice: 500},
		},
	}))
	if err != nil {
		t.Fatalf("create other: %v", err)
	}

	res, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId:    warehouse,
		Page:      &commonv1.PageFilter{Page: 1, Limit: 50},
		ProductId: wanted,
	}))
	if err != nil {
		t.Fatalf("RestockRequestList: %v", err)
	}

	got := res.Msg.GetRequests()
	if len(got) != 1 {
		t.Fatalf("filtered list holds %d requests, want exactly 1 — a JOIN would return the "+
			"two-line request twice", len(got))
	}
	if got[0].GetId() != twice.Msg.GetRequest().GetId() {
		t.Fatalf("filtered list holds request %d, want %d", got[0].GetId(), twice.Msg.GetRequest().GetId())
	}
	if n := res.Msg.GetPageInfo().GetTotalItems(); n != 1 {
		t.Fatalf("filtered total = %d, want 1", n)
	}

	// 0 means no filter.
	unfiltered, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: warehouse, Page: &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("unfiltered list: %v", err)
	}
	if len(unfiltered.Msg.GetRequests()) != 2 {
		t.Fatalf("unfiltered list holds %d requests, want 2", len(unfiltered.Msg.GetRequests()))
	}
}
