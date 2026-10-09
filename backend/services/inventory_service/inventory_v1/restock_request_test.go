package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"gorm.io/gorm"
)

const (
	ongoing   = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING
	accepted  = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED
	cancelled = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED

	broken  = inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_BROKEN
	missing = inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_MISSING
)

// stagingCode is the code of the staging placement a test with no shelf in it puts everything on.
const stagingCode = "AREA-TERIMA"

// stagingPlacement is the warehouse's staging placement — its *Area Terima* — found, or made the first time it is
// asked for. Every unit in stock is on a placement (there-is-no-unplaced-pile): a staging area is an ordinary placement,
// so a test that is about neither a shortfall nor a shelf puts everything here instead of on the pile that no longer
// exists.
func stagingPlacement(t *testing.T, db *gorm.DB, warehouse uint64) uint64 {
	t.Helper()

	rack := inventory_service_models.Rack{}

	err := db.
		Where("warehouse_id = ? AND code = ? AND deleted = FALSE", warehouse, stagingCode).
		Attrs(inventory_service_models.Rack{WarehouseID: warehouse, Code: stagingCode, Name: "Area Terima"}).
		FirstOrCreate(&rack).
		Error
	if err != nil {
		t.Fatalf("staging placement: %v", err)
	}

	return rack.ID
}

// allArrived is the "everything turned up as asked, and went to the staging placement" count — what a test that is
// about neither a shortfall nor a shelf means when it accepts.
//
// Accepting is a COUNT (#133) that also says WHERE (#137), and neither has a shortcut: there is no "accept it as asked"
// and no "put it somewhere". So even the tests that do not care have to say both out loud — and the staging placement
// is the honest answer for a test with no shelf in it (there-is-no-unplaced-pile).
func allArrived(t *testing.T, db *gorm.DB, r *inventoryv1.RestockRequest) []*inventoryv1.RestockRequestReceivedLine {
	t.Helper()

	return onePlace(r, stagingPlacement(t, db, r.GetWarehouseId()))
}

// onePlace is the count for a test that cares WHERE, but only about one placement: everything arrived, nothing was
// broken, and all of it went to `placement`.
func onePlace(r *inventoryv1.RestockRequest, placement uint64) []*inventoryv1.RestockRequestReceivedLine {
	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, len(r.GetItems()))
	for _, item := range r.GetItems() {
		lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
			ItemId:        item.GetId(),
			ReceivedCount: item.GetCount(),
			Placements:    placedOn(placement, item.GetCount()),
		})
	}

	return lines
}

func TestRestockRequest_CreateListAccept(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 5000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Msg.GetRequest().GetStatus() != ongoing {
		t.Fatalf("new request status = %v, want ONGOING", created.Msg.GetRequest().GetStatus())
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
		if len(requestRows(lst.Msg)) != 1 {
			t.Fatalf("team %d list = %d, want 1", team, len(requestRows(lst.Msg)))
		}
	}

	// An unrelated team sees nothing.
	other, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{TeamId: 9, Page: page1()}))
	if err != nil {
		t.Fatalf("list other: %v", err)
	}
	if len(requestRows(other.Msg)) != 0 {
		t.Fatalf("unrelated team should see 0 requests, got %d", len(requestRows(other.Msg)))
	}

	// A non-target warehouse cannot accept it (reads as NotFound). The count is valid, so this proves
	// the SCOPE is what refuses it, not a malformed count.
	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: 9, RequestId: reqID, Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-warehouse accept code = %v, want NotFound", connect.CodeOf(err))
	}

	// The target warehouse accepts: status ACCEPTED and the stock is received.
	ful, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: reqID, Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if ful.Msg.GetRequest().GetStatus() != accepted {
		t.Fatalf("status = %v, want ACCEPTED", ful.Msg.GetRequest().GetStatus())
	}

	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{WarehouseId: warehouse, Page: page1()}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}
	if len(stockLevelRows(levels.Msg)) != 1 || stockLevelRows(levels.Msg)[0].GetOnHand() != 10 {
		t.Fatalf("on-hand after accept should be 10, got %+v", stockLevelRows(levels.Msg))
	}

	// Re-accepting an accepted request is rejected (accept-locks-the-restock).
	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: reqID, Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("re-accept code = %v, want FailedPrecondition", connect.CodeOf(err))
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
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	// One of each status: ongoing, accepted, cancelled.
	stillPending := newRequest()

	toFulfil := newRequest()
	_, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: toFulfil.GetId(), Lines: allArrived(t, db, toFulfil),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
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
			TeamId: team, Filter: &inventoryv1.RestockRequestListFilter{Status: status}, Page: page1(),
		}))
		if listErr != nil {
			t.Fatalf("list: %v", listErr)
		}

		return requestRows(resp.Msg)
	}

	// UNSPECIFIED is the "All Status" tab.
	if all := list(sellingTeam, inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED); len(all) != 3 {
		t.Fatalf("all-status tab = %d, want 3", len(all))
	}

	// Each status tab returns only its own.
	onlyPending := list(sellingTeam, ongoing)
	if len(onlyPending) != 1 || onlyPending[0].GetId() != stillPending.GetId() {
		t.Fatalf("ongoing tab = %+v, want just the ongoing one", onlyPending)
	}

	if only := list(sellingTeam, accepted); len(only) != 1 || only[0].GetId() != toFulfil.GetId() {
		t.Fatalf("accepted tab = %+v", only)
	}

	if only := list(sellingTeam, cancelled); len(only) != 1 || only[0].GetId() != toCancel.GetId() {
		t.Fatalf("cancelled tab = %+v", only)
	}

	// The WAREHOUSE side sees the same requests through its own leg of the OR, and the tab must
	// filter that leg too. This is what catches the operator-precedence trap: an unparenthesised
	// `requesting_team_id = ? OR warehouse_id = ? AND status = ?` binds the AND to the warehouse leg
	// only, so the selling team's list would quietly ignore the tab.
	if only := list(warehouse, ongoing); len(only) != 1 || only[0].GetId() != stillPending.GetId() {
		t.Fatalf("warehouse ongoing tab = %+v, want just the ongoing one", only)
	}

	// And the counts must be the FILTERED totals, or the pager lies.
	resp, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: sellingTeam, Filter: &inventoryv1.RestockRequestListFilter{Status: ongoing}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("ongoing total = %d, want 1 (the pager must count the FILTERED set)",
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
		TeamId: sellingTeam, WarehouseId: warehouse, Receipt: "JP99",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 2, Total: 1500},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Count: 5, Total: 700},
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
		if got.GetReceipt() != "JP99" || got.GetItems()[1].GetTotal() != 700 {
			t.Fatalf("team %d: detail did not round-trip: %+v", team, got)
		}

		// The line is typed as its total (a-line-is-typed-as-its-total); the unit price is read-only, worked out on
		// read — 1.500 over 2 is 750 a piece.
		if got.GetItems()[0].GetPriceUnit() != 750 {
			t.Fatalf("team %d: price_unit = %d, want 750 (total ÷ count)", team, got.GetItems()[0].GetPriceUnit())
		}

		// Subtotal is the lines, total adds the freight — here none (the-couriers-charge-stays-out-of-total).
		if got.GetSubtotal() != 2200 || got.GetTotal() != 2200 {
			t.Fatalf("team %d: subtotal/total = %d/%d, want 2200/2200", team, got.GetSubtotal(), got.GetTotal())
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

// The restock's own money and context (#127): a free-text invoice REFERENCE (not an id — it names an order in
// someone else's system, a-restock-keeps-its-invoice-reference), what the freight cost, and a note — and the
// totals worked out from them.
//
// a-restock-names-its-paying-account: a new restock names the account that paid instead of a payment TYPE, so the
// type is no longer written; it is READ-ONLY history on restocks raised before, which this test still reads back.
func TestRestockRequest_InvoiceRefPaymentAndNote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: 5,
		// Deliberately NOT numeric: the reference is whatever the marketplace calls it, and the old
		// uint64 could not hold this at all.
		InvoiceRefId:     "SHP-2026-ABC/01",
		ShipmentCost:     18000,
		FinanceAccountId: 7,
		Note:             "titip ke driver, jangan ditinggal di pos",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 3, Total: 4000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got := created.Msg.GetRequest()
	if got.GetInvoiceRefId() != "SHP-2026-ABC/01" {
		t.Fatalf("invoice ref = %q, want the non-numeric reference back", got.GetInvoiceRefId())
	}
	if got.GetShipmentCost() != 18000 {
		t.Fatalf("shipment cost = %d, want 18000", got.GetShipmentCost())
	}
	if got.GetNote() != "titip ke driver, jangan ditinggal di pos" {
		t.Fatalf("note did not round-trip: %q", got.GetNote())
	}

	// The goods and the agreed freight — what the paying account paid (the-couriers-charge-stays-out-of-total).
	if got.GetSubtotal() != 4000 || got.GetTotal() != 22000 {
		t.Fatalf("subtotal/total = %d/%d, want 4000/22000", got.GetSubtotal(), got.GetTotal())
	}

	// A new restock writes no payment type: that is history, and the account replaced it.
	if got.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_UNSPECIFIED {
		t.Fatalf("payment type = %v, want UNSPECIFIED on a new restock", got.GetPaymentType())
	}

	// A restock raised BEFORE paying accounts carries its type as stored text; it must still read back. Written
	// around the API because no request can write it any more.
	err = db.
		Model(&inventory_service_models.RestockRequest{}).
		Where("id = ?", got.GetId()).
		Update("payment_type", "shopee_pay").
		Error
	if err != nil {
		t.Fatalf("seed a historic payment type: %v", err)
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
		back.GetInvoiceRefId() != "SHP-2026-ABC/01" || back.GetShipmentCost() != 18000 ||
		back.GetTotal() != 22000 {
		t.Fatalf("context did not survive the round trip: %+v", back)
	}
}

// None of #127's context is required: no invoice, no freight, no note is a perfectly good request, and no payment
// type comes back UNSPECIFIED, not a guess. (The paying account IS required — a-restock-names-its-paying-account —
// but that is the contract's gt 0, enforced by the validation interceptor, which a handler called directly skips.)
func TestRestockRequest_PaymentContextOptional(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create without #127 context: %v", err)
	}

	got := created.Msg.GetRequest()
	if got.GetInvoiceRefId() != "" || got.GetShipmentCost() != 0 || got.GetNote() != "" {
		t.Fatalf("absent context should be zero, got %+v", got)
	}
	if got.GetSubtotal() != 100 || got.GetTotal() != 100 {
		t.Fatalf("subtotal/total = %d/%d, want 100/100 with no freight", got.GetSubtotal(), got.GetTotal())
	}
	if got.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_UNSPECIFIED {
		t.Fatalf("payment type = %v, want UNSPECIFIED", got.GetPaymentType())
	}
}

// A request carries MANY priced lines, and accepting it receives EVERY one of them (#124).
func TestRestockRequest_MultipleItemsAllReceived(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 4, Total: 5000},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Count: 7, Total: 12500},
			// Price 0 is legitimate — a transfer or a sample, not a mistake.
			{ProductId: 300, Sku: "SKU3", Name: "Freebie", Count: 1},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got := created.Msg.GetRequest()
	if len(got.GetItems()) != 3 {
		t.Fatalf("items = %d, want 3", len(got.GetItems()))
	}
	if got.GetItems()[1].GetTotal() != 12500 || got.GetItems()[1].GetSku() != "SKU2" {
		t.Fatalf("line did not round-trip: %+v", got.GetItems()[1])
	}

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: got.GetId(), Lines: allArrived(t, db, got),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// Every line landed as its own on-hand.
	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	onHand := map[uint64]int64{}
	for _, l := range stockLevelRows(levels.Msg) {
		onHand[l.GetProductId()] = l.GetOnHand()
	}

	if onHand[100] != 4 || onHand[200] != 7 || onHand[300] != 1 {
		t.Fatalf("every line should be received, got %+v", onHand)
	}
}

// The optional supplier must be a LIVE supplier — any selling team's, since team B restocks from team A's
// supplier on its own restock (a-team-restocks-from-another-teams-supplier). A deleted one and an id that
// exists nowhere are the same NotFound.
func TestRestockRequest_SupplierMustBeLive(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := ctxUser(1)

	const (
		sellingTeam uint64 = 2
		mine        uint64 = 31
		theirs      uint64 = 32
		deleted     uint64 = 33
	)

	svc := newServiceWithSuppliers(t, db, fakeSuppliers{mine: true, theirs: true, deleted: false})

	// The supplier rides each LINE now (a-line-connects-to-any-teams-supplier-from-a-popup).
	create := func(supplierID uint64) error {
		_, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: 5,
			InvoiceRefId: "SHP-77", Receipt: "JP1234567890",
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100, SupplierId: supplierID},
			},
		}))

		return err
	}

	// Our own supplier is fine, and the optional context round-trips.
	resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5,
		InvoiceRefId: "SHP-77", Receipt: "JP1234567890",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100, SupplierId: mine},
		},
	}))
	if err != nil {
		t.Fatalf("create with own supplier: %v", err)
	}
	if got := resp.Msg.GetRequest(); got.GetItems()[0].GetSupplierId() != mine || got.GetInvoiceRefId() != "SHP-77" ||
		got.GetReceipt() != "JP1234567890" {
		t.Fatalf("optional context did not round-trip: %+v", got)
	}

	// Another team's LIVE supplier is accepted.
	if err = create(theirs); err != nil {
		t.Fatalf("another team's live supplier must be accepted, got %v", err)
	}

	// A deleted supplier and an unknown id are the same NotFound.
	for _, id := range []uint64{deleted, 999999} {
		if code := connect.CodeOf(create(id)); code != connect.CodeNotFound {
			t.Fatalf("supplier %d code = %v, want NotFound", id, code)
		}
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
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 2, Total: 900},
		},
	}))
	if err != nil {
		t.Fatalf("create without optional context: %v", err)
	}

	got := created.Msg.GetRequest()
	if got.GetItems()[0].GetSupplierId() != 0 || got.GetInvoiceRefId() != "" || got.GetReceipt() != "" {
		t.Fatalf("absent context should be zero, got %+v", got)
	}
}

// The supplier rides each LINE in the contract (a-line-connects-to-any-teams-supplier-from-a-popup), but until lines
// store their own it is kept once per restock: the supplier every line names. Lines that DISAGREE keep none rather
// than crediting the whole restock to the first one — a supplier's figures read it — and every line reads back the
// same answer.
func TestRestockRequest_LinesThatDisagreeOnTheSupplierKeepNone(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := ctxUser(1)

	const (
		sellingTeam uint64 = 2
		melati      uint64 = 31
		sinar       uint64 = 32
	)

	svc := newServiceWithSuppliers(t, db, fakeSuppliers{melati: true, sinar: true})

	create := func(first, second uint64) *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: 5,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100, SupplierId: first},
				{ProductId: 200, Sku: "SKU2", Name: "Gadget", Count: 1, Total: 100, SupplierId: second},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
			TeamId: sellingTeam, RequestId: resp.Msg.GetRequest().GetId(),
		}))
		if err != nil {
			t.Fatalf("detail: %v", err)
		}

		return detail.Msg.GetRequest()
	}

	for name, c := range map[string]struct {
		first, second, want uint64
	}{
		"both lines from one supplier": {melati, melati, melati},
		"two suppliers":                {melati, sinar, 0},
		"one line names none":          {melati, 0, 0},
	} {
		got := create(c.first, c.second)

		for i, item := range got.GetItems() {
			if item.GetSupplierId() != c.want {
				t.Fatalf("%s: line %d reads supplier %d, want %d", name, i, item.GetSupplierId(), c.want)
			}
		}
	}
}

// #133 — the heart of it: STOCK RECEIVES WHAT WAS COUNTED, never what was asked for. A request is a
// promise; the delivery is a fact, and receiving the promise would be inventing stock the warehouse
// does not have.
func TestRestockRequest_AcceptReceivesWhatArrivedNotWhatWasAsked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Short", Count: 10, Total: 5000},
			{ProductId: 200, Sku: "SKU2", Name: "Exact", Count: 3, Total: 1000},
			{ProductId: 300, Sku: "SKU3", Name: "Over", Count: 5, Total: 200},
			{ProductId: 400, Sku: "SKU4", Name: "Missing", Count: 2, Total: 900},
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
			ItemId: id, ReceivedCount: qty,
			Placements: placedOn(shelf, qty),
		}
	}

	count := func(lines []*inventoryv1.RestockRequestItem) []*inventoryv1.RestockRequestReceivedLine {
		return []*inventoryv1.RestockRequestReceivedLine{
			onShelf(lines[0].GetId(), 9),
			onShelf(lines[1].GetId(), 3),
			onShelf(lines[2].GetId(), 6),
			{ItemId: lines[3].GetId(), ReceivedCount: 0},
		}
	}

	// accept-refuses-more-than-the-line-says: 6 in the box against a line of 5 is the selling team's edit to make
	// first. The warehouse counts; it does not decide what the selling team owns — so the over-delivered line STOPS
	// the accept rather than being received as counted.
	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(), Lines: count(items),
	}))
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("accepting more than the line says = %v, want InvalidArgument", code)
	}

	// extra-units-are-added-by-the-selling-teams-edit: the selling team turns 5 into 6, and the warehouse accepts
	// what the line now says. An edit is a full replace, so the lines come back with new ids.
	edited, err := svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: req.GetId(), WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Short", Count: 10, Total: 5000},
			{ProductId: 200, Sku: "SKU2", Name: "Exact", Count: 3, Total: 1000},
			{ProductId: 300, Sku: "SKU3", Name: "Over", Count: 6, Total: 240, Note: "extra stock"},
			{ProductId: 400, Sku: "SKU4", Name: "Missing", Count: 2, Total: 900},
		},
	}))
	if err != nil {
		t.Fatalf("the selling team adds the extra unit: %v", err)
	}

	ful, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(), Lines: count(edited.Msg.GetRequest().GetItems()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// A short count still ACCEPTS: the delivery happened, and the request has done its job.
	if ful.Msg.GetRequest().GetStatus() != accepted {
		t.Fatalf("a short delivery still accepts, got %v", ful.Msg.GetRequest().GetStatus())
	}

	// BOTH numbers survive — the gap is the record's whole point.
	//
	// Read back through Detail, which is a FRESH DB read. Asserting this on the accept RESPONSE would
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
	for i, want := range []struct{ asked, arrived int64 }{{10, 9}, {3, 3}, {6, 6}, {2, 0}} {
		if got[i].GetCount() != want.asked || got[i].GetReceivedCount() != want.arrived {
			t.Fatalf("line %d AS STORED: asked=%d arrived=%d, want asked=%d arrived=%d",
				i, got[i].GetCount(), got[i].GetReceivedCount(), want.asked, want.arrived)
		}
	}

	// THE GAP IS WRITTEN DOWN, not just implied (a-short-unit-at-the-door-is-missing): count − received, as a MISSING
	// row priced by the system from the line (the-problem-price-is-filled-by-the-system). Nobody typed it.
	for i, want := range []struct {
		missing, priceUnit, total int64
	}{{1, 500, 500}, {0, 0, 0}, {0, 0, 0}, {2, 450, 900}} {
		problems := got[i].GetProblems()

		if want.missing == 0 {
			if len(problems) != 0 {
				t.Fatalf("line %d: a line that arrived in full has problems %v", i, problems)
			}

			continue
		}

		if len(problems) != 1 || problems[0].GetType() != missing || problems[0].GetCount() != want.missing {
			t.Fatalf("line %d: problems = %v, want one MISSING row of %d", i, problems, want.missing)
		}

		if problems[0].GetPriceUnit() != want.priceUnit || problems[0].GetTotal() != want.total {
			t.Fatalf("line %d: missing worth %d × … = %d, want %d / %d", i,
				problems[0].GetPriceUnit(), problems[0].GetTotal(), want.priceUnit, want.total)
		}
	}

	// And the response must AGREE with the row — it is what the screen renders the instant the dialog
	// closes, so a response that flatters the stored truth would be a lie with a short shelf life.
	for i, item := range ful.Msg.GetRequest().GetItems() {
		if item.GetReceivedCount() != got[i].GetReceivedCount() {
			t.Fatalf("line %d: the response says %d arrived, the stored row says %d",
				i, item.GetReceivedCount(), got[i].GetReceivedCount())
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
	for _, lvl := range stockLevelRows(levels.Msg) {
		onHand[lvl.GetProductId()] = lvl.GetOnHand()
	}

	for product, want := range map[uint64]int64{100: 9, 200: 3, 300: 6} {
		if onHand[product] != want {
			t.Fatalf("product %d on-hand = %d, want %d (the COUNT, not the ask)", product, onHand[product], want)
		}
	}

	if _, present := onHand[400]; present {
		t.Fatalf("a line that never arrived must not create a stock level, got %+v", stockLevelRows(levels.Msg))
	}
}

// #137 — counting and shelving are ONE act: the goods land on the shelf the warehouse NAMED, not in an
// unplaced pile someone has to work through afterwards.
func TestRestockRequest_AcceptPutsGoodsOnTheNamedShelf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rackA := insertRack(t, db, warehouse, "A-01-3")
	rackB := insertRack(t, db, warehouse, "A-02-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 500},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Count: 4, Total: 700},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	items := req.GetItems()

	// Two lines, two different shelves — a delivery does not all go to one place.
	ful, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: items[0].GetId(), ReceivedCount: 10, Placements: placedOn(rackA, 10)},
			{ItemId: items[1].GetId(), ReceivedCount: 4, Placements: placedOn(rackB, 4)},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// The request remembers where each line was put.
	for i, want := range []uint64{rackA, rackB} {
		places := ful.Msg.GetRequest().GetItems()[i].GetPlacements()
		if len(places) != 1 {
			t.Fatalf("line %d recorded %d placements, want 1", i, len(places))
		}
		if got := places[0].GetPlacementId(); got != want {
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
// read as a place: guessing a place for real goods is how stock ends up somewhere nobody looked, and there is no
// pile to fall back on (there-is-no-unplaced-pile). A line that did NOT arrive owes no place — there is nothing to
// put anywhere.
func TestRestockRequest_AcceptRefusesArrivedGoodsWithNoPlace(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	create := func() *inventoryv1.RestockRequest {
		t.Helper()

		created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 3, Total: 500},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return created.Msg.GetRequest()
	}

	// Arrived, but no place named → refused.
	req := create()

	_, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: req.GetItems()[0].GetId(), ReceivedCount: 3},
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
	if len(stockLevelRows(levels.Msg)) != 0 {
		t.Fatalf("a refused acceptance must move no stock, got %+v", stockLevelRows(levels.Msg))
	}

	// A line that did NOT arrive owes no place — nothing is there to put anywhere.
	nothingCame := create()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: nothingCame.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: nothingCame.GetItems()[0].GetId(), ReceivedCount: 0},
		},
	}))
	if err != nil {
		t.Fatalf("a line that never turned up owes no place, got: %v", err)
	}
}

// #137 — the shelf must belong to the ACCEPTING warehouse. Another warehouse's rack reads as NotFound,
// never PermissionDenied: a permission error would confirm the id exists.
func TestRestockRequest_AcceptCrossWarehouseRackIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse, otherWarehouse uint64 = 2, 5, 6

	theirShelf := insertRack(t, db, otherWarehouse, "B-01-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 3, Total: 500},
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
		_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: warehouse, RequestId: req.GetId(),
			Lines: []*inventoryv1.RestockRequestReceivedLine{
				{
					ItemId: req.GetItems()[0].GetId(), ReceivedCount: 3,
					Placements: placedOn(rack, 3),
				},
			},
		}))
		if code := connect.CodeOf(err); code != connect.CodeNotFound {
			t.Fatalf("%s = %v, want NotFound", name, code)
		}
	}
}

// received_count rides the SHARED line message (a line reads back what arrived), so create and edit
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
				ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 500,
				ReceivedCount: 10,
				Placements:    placedOn(shelf, 10),
				// And writes off two of its own goods while it is at it (#154).
				Problems: []*inventoryv1.RestockProblemItem{
					{Count: 2, Note: "claimed by the requester", Type: missing},
				},
			},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	if got := req.GetItems()[0].GetReceivedCount(); got != 0 {
		t.Fatalf("create honoured a claimed receipt: received = %d, want 0", got)
	}
	if got := req.GetItems()[0].GetPlacements(); len(got) != 0 {
		t.Fatalf("create honoured a claimed SHELF: placements = %v, want none (#137/#154)", got)
	}
	if got := req.GetItems()[0].GetProblems(); len(got) != 0 {
		t.Fatalf("create honoured a claimed WRITE-OFF: problems = %v, want none (#154)", got)
	}

	// And again on edit.
	updated, err := svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: req.GetId(), WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{
				ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 500,
				ReceivedCount: 10,
				Placements:    placedOn(shelf, 10),
				// And writes off two of its own goods while it is at it (#154).
				Problems: []*inventoryv1.RestockProblemItem{
					{Count: 2, Note: "claimed by the requester", Type: missing},
				},
			},
		},
	}))
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := updated.Msg.GetRequest().GetItems()[0].GetReceivedCount(); got != 0 {
		t.Fatalf("edit honoured a claimed receipt: received = %d, want 0", got)
	}
	if got := updated.Msg.GetRequest().GetItems()[0].GetPlacements(); len(got) != 0 {
		t.Fatalf("edit honoured a claimed SHELF: placements = %v, want none (#137/#154)", got)
	}
	if got := updated.Msg.GetRequest().GetItems()[0].GetProblems(); len(got) != 0 {
		t.Fatalf("edit honoured a claimed WRITE-OFF: problems = %v, want none (#154)", got)
	}

	// Nothing reached stock, either — the claim moved no goods.
	levels, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}
	if len(stockLevelRows(levels.Msg)) != 0 {
		t.Fatalf("a claimed receipt must move no stock, got %+v", stockLevelRows(levels.Msg))
	}
}

// Accepting IS the count (#133), so a count that does not cover the request exactly is refused rather
// than interpreted: reading an omitted line as "all of it came" or "none did" is a guess, and a guess
// about stock is drift.
func TestRestockRequest_AcceptRefusesAnIncompleteCount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 4, Total: 500},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Count: 6, Total: 700},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	items := req.GetItems()

	tryCount := func(lines []*inventoryv1.RestockRequestReceivedLine) error {
		_, fulErr := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: warehouse, RequestId: req.GetId(), Lines: lines,
		}))

		return fulErr
	}

	// Every counted line names a real placement, so what refuses each case below is the COUNT — not a line with
	// good units and nowhere to put them, which is its own refusal.
	staging := stagingPlacement(t, db, warehouse)

	counted := func(itemID uint64, n int64) *inventoryv1.RestockRequestReceivedLine {
		return &inventoryv1.RestockRequestReceivedLine{
			ItemId: itemID, ReceivedCount: n, Placements: placedOn(staging, n),
		}
	}

	cases := map[string][]*inventoryv1.RestockRequestReceivedLine{
		"a line left uncounted": {
			counted(items[0].GetId(), 4),
		},
		"the same line counted twice": {
			counted(items[0].GetId(), 4),
			counted(items[0].GetId(), 4),
		},
		"a line that is not on this request": {
			counted(items[0].GetId(), 4),
			counted(999999, 6),
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
	if len(stockLevelRows(levels.Msg)) != 0 {
		t.Fatalf("a refused count must move no stock, got %+v", stockLevelRows(levels.Msg))
	}

	if err = tryCount(allArrived(t, db, req)); err != nil {
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
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 5000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	edit := &inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: reqID,
		// Even the warehouse may change: nothing has been accepted, so nothing is committed to it.
		WarehouseId: otherWarehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Count: 3, Total: 1500},
			{ProductId: 300, Sku: "SKU3", Name: "Gizmo", Count: 7, Total: 250},
		},
		Receipt: "SC9999", InvoiceRefId: "SHP-42", ShipmentCost: 12000,
		// The paying account replaced the payment type (a-restock-names-its-paying-account) — an edit names an
		// account, and the type is not the edit's to write.
		FinanceAccountId: 7,
		Note:             "edited before the warehouse took it",
	}

	// Another team cannot edit it — indistinguishable from one that does not exist.
	_, err = svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: 9, RequestId: reqID, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: 1, Sku: "X", Name: "X", Count: 1}},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team update code = %v, want NotFound", connect.CodeOf(err))
	}

	updated, err := svc.RestockRequestUpdate(ctx, connect.NewRequest(edit))
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	got := updated.Msg.GetRequest()
	if got.GetStatus() != ongoing {
		t.Fatalf("an edit must not move the status: got %v, want ONGOING", got.GetStatus())
	}
	if got.GetWarehouseId() != otherWarehouse ||
		got.GetReceipt() != "SC9999" || got.GetInvoiceRefId() != "SHP-42" ||
		got.GetShipmentCost() != 12000 || got.GetNote() != "edited before the warehouse took it" ||
		got.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_UNSPECIFIED {
		t.Fatalf("edit did not round-trip: %+v", got)
	}

	// The totals follow the replaced lines: 1.500 + 250, plus the edited freight.
	if got.GetSubtotal() != 1750 || got.GetTotal() != 13750 {
		t.Fatalf("subtotal/total = %d/%d, want 1750/13750", got.GetSubtotal(), got.GetTotal())
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
	if items[0].GetSku() != "SKU2" || items[0].GetCount() != 3 || items[0].GetTotal() != 1500 ||
		items[1].GetSku() != "SKU3" || items[1].GetCount() != 7 {
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
		if len(requestRows(lst.Msg)) != want {
			t.Fatalf("team %d sees %d requests, want %d", team, len(requestRows(lst.Msg)), want)
		}
	}
}

// An edit is a full REPLACE, so emptying a field CLEARS it. This is the case a struct-based
// Updates() would silently drop (GORM skips a struct's zero values) — leaving the old note and
// supplier in place while the form showed them gone.
//
// The one exception is the payment TYPE, which an edit no longer carries at all: it is read-only history on a restock
// raised before paying accounts (a-restock-names-its-paying-account), so an edit leaves it as it was rather than
// clearing it.
func TestRestockRequest_UpdateClearsOptionalContext(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := ctxUser(1)

	const (
		sellingTeam uint64 = 2
		supplier    uint64 = 31
	)

	svc := newServiceWithSuppliers(t, db, fakeSuppliers{supplier: true})

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5,
		InvoiceRefId: "SHP-1", Receipt: "JP1", ShipmentCost: 9000,
		Note: "please hurry",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100, SupplierId: supplier},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	// A historic payment type, as a restock raised before paying accounts carries it — written around the API,
	// because no request can write one any more.
	err = db.
		Model(&inventory_service_models.RestockRequest{}).
		Where("id = ?", reqID).
		Update("payment_type", "shopee_pay").
		Error
	if err != nil {
		t.Fatalf("seed a historic payment type: %v", err)
	}

	// Everything optional left out: the person cleared the lot.
	_, err = svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: reqID, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100},
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
	if got.GetItems()[0].GetSupplierId() != 0 || got.GetInvoiceRefId() != "" || got.GetReceipt() != "" ||
		got.GetShipmentCost() != 0 || got.GetNote() != "" {
		t.Fatalf("cleared fields were kept: %+v", got)
	}

	// a-restock-names-its-paying-account: the payment type is history, not an editable field — the edit kept it.
	if got.GetPaymentType() != inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_SHOPEE_PAY {
		t.Fatalf("payment type = %v, want the historic SHOPEE_PAY kept through the edit", got.GetPaymentType())
	}
}

// "when restock not accepted by warehouse. its freely edited" (#131) — the converse is the guard:
// once it is accepted (or cancelled), it is not editable at all (a-restock-is-edited-only-while-ongoing).
func TestRestockRequest_UpdateOnlyWhileOngoing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	newPending := func() *inventoryv1.RestockRequest {
		t.Helper()

		created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 4, Total: 500},
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
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 999, Total: 500},
			},
		}))

		return err
	}

	// Accepted by the warehouse: the goods have moved, so the record is history.
	accepted := newPending()

	_, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: accepted.GetId(), Lines: allArrived(t, db, accepted),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
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
	if qty := detail.Msg.GetRequest().GetItems()[0].GetCount(); qty != 4 {
		t.Fatalf("refused edit still wrote: count = %d, want 4", qty)
	}
}

// The supplier rule holds on edit exactly as on create: any team's live supplier, never a deleted one — and
// a refused edit applies nothing.
func TestRestockRequest_UpdateSupplierMustBeLive(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := ctxUser(1)

	const (
		sellingTeam uint64 = 2
		mine        uint64 = 31
		theirs      uint64 = 32
		deleted     uint64 = 33
	)

	svc := newServiceWithSuppliers(t, db, fakeSuppliers{mine: true, theirs: true, deleted: false})

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	// The supplier rides each line (a-line-connects-to-any-teams-supplier-from-a-popup).
	edit := func(supplierID uint64) error {
		_, updErr := svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
			TeamId: sellingTeam, RequestId: reqID, WarehouseId: 5,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100, SupplierId: supplierID},
			},
		}))

		return updErr
	}

	if err = edit(mine); err != nil {
		t.Fatalf("edit to own supplier: %v", err)
	}

	if err = edit(theirs); err != nil {
		t.Fatalf("edit to another team's live supplier: %v", err)
	}

	if code := connect.CodeOf(edit(deleted)); code != connect.CodeNotFound {
		t.Fatalf("deleted supplier on edit = %v, want NotFound", code)
	}

	// The rejected edit must not have half-applied — the supplier is still the last good one.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: reqID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if got := detail.Msg.GetRequest().GetItems()[0].GetSupplierId(); got != theirs {
		t.Fatalf("supplier after rejected edit = %d, want %d", got, theirs)
	}
}

// Deleting a supplier must not brick the pending requests that already name it. Because an edit is a
// full replace, the form re-sends the supplier it prefilled — so re-validating an UNCHANGED id would
// reject the edit over a field the person never touched, and SupplierDelete is a soft delete, so the
// id keeps resolving to a supplier that SupplierIsLive() refuses.
func TestRestockRequest_UpdateKeepsDeletedSupplierItAlreadyHad(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := ctxUser(1)

	const (
		sellingTeam uint64 = 2
		supplier    uint64 = 31
	)

	suppliers := fakeSuppliers{supplier: true}
	svc := newServiceWithSuppliers(t, db, suppliers)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100, SupplierId: supplier},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reqID := created.Msg.GetRequest().GetId()

	// The supplier is deleted in supplier_service — from now on it is not live.
	suppliers[supplier] = false

	// The edit re-sends the prefilled (now deleted) supplier and changes only the note.
	_, err = svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: reqID, WarehouseId: 5,
		Note: "just fixing a typo",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100, SupplierId: supplier},
		},
	}))
	if err != nil {
		t.Fatalf("editing a request whose supplier was deleted must still work, got: %v", err)
	}

	// But POINTING a request at a deleted supplier it did not already have is still refused.
	fresh, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create fresh: %v", err)
	}

	_, err = svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: sellingTeam, RequestId: fresh.Msg.GetRequest().GetId(), WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100, SupplierId: supplier},
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
			{ProductId: 100, Sku: "S", Name: "N", Count: 3},
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

	// The requester cancels an ongoing request.
	c, err := svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{TeamId: 2, RequestId: reqID}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if c.Msg.GetRequest().GetStatus() != cancelled {
		t.Fatalf("status = %v, want CANCELLED", c.Msg.GetRequest().GetStatus())
	}

	// Cancelling a request that is no longer ongoing is rejected (a-restock-is-cancelled-only-while-ongoing).
	_, err = svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{TeamId: 2, RequestId: reqID}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("re-cancel code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// And a cancelled restock cannot be counted in: accept takes it from ongoing or arrived only
	// (accept-locks-the-restock).
	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: 5, RequestId: reqID, Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("accepting a cancelled restock = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// an-accepted-restock-cannot-be-cancelled: once the warehouse has counted the box in, the goods are stock and the
// selling team can no longer call it off.
func TestRestockRequest_AnAcceptedRestockCannotBeCancelled(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "S", Name: "N", Count: 3, Total: 300},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: 5, RequestId: req.GetId(), Lines: allArrived(t, db, req),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	_, err = svc.RestockRequestCancel(ctx, connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: 2, RequestId: req.GetId(),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("cancelling an accepted restock = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// placedOn is the ordinary single-placement case: all of it went to one shelf (#154). Named apart from
// stock_move_test.go's onRack, which builds a StockPlace for a different RPC.
func placedOn(rack uint64, qty int64) []*inventoryv1.RestockPlacement {
	return []*inventoryv1.RestockPlacement{
		{PlacementId: rack, Quantity: qty},
	}
}

// #154 — A DELIVERY OF 100 DOES NOT GO ON ONE SHELF. A line's goods can be split across several
// places, and each split is its own ledger row rather than one row averaging a location the goods
// never sat in.
func TestRestockRequest_AcceptSplitsALineAcrossSeveralShelves(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rackA := insertRack(t, db, warehouse, "A-01-1")
	rackB := insertRack(t, db, warehouse, "B-02-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 100, Total: 1000000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	// there-is-no-unplaced-pile: the 10 not shelved yet sit on the warehouse's staging placement, an ordinary
	// placement like any rack — not on a rack-less pile.
	staging := stagingPlacement(t, db, warehouse)

	// 100 arrived: 60 on A, 30 on B, and 10 not shelved yet — a real, ordinary put-away.
	ful, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: req.GetItems()[0].GetId(), ReceivedCount: 100,
				Placements: []*inventoryv1.RestockPlacement{
					{PlacementId: rackA, Quantity: 60},
					{PlacementId: rackB, Quantity: 30},
					{PlacementId: staging, Quantity: 10},
				},
			},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	places := ful.Msg.GetRequest().GetItems()[0].GetPlacements()
	if len(places) != 3 {
		t.Fatalf("recorded %d placements, want 3: %v", len(places), places)
	}

	// The stock is where it was actually put — checked per shelf, because a total alone would pass
	// even if all 100 had landed in one place.
	for _, want := range []struct {
		label string
		rack  *uint64
		qty   int64
	}{{"rack A", &rackA, 60}, {"rack B", &rackB, 30}, {"the staging placement", &staging, 10}, {"no placement", nil, 0}} {
		got := onHandAt(t, db, warehouse, 100, want.rack)
		if got != want.qty {
			t.Fatalf("%s holds %d, want %d", want.label, got, want.qty)
		}
	}
}

// #154 — the placements must ADD UP to the count beside them.
//
// Somebody who says "8 arrived" and then puts 7 away has made a mistake in one of the two, and which
// one is not knowable from here. Refused, never interpreted — the same rule as an incomplete count
// (#133). Guessing would put the difference somewhere nobody chose.
func TestRestockRequest_AcceptRefusesPlacementsThatDoNotAddUp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rack := insertRack(t, db, warehouse, "A-01-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 50000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	for name, placements := range map[string][]*inventoryv1.RestockPlacement{
		"placed less than counted": {
			{PlacementId: rack, Quantity: 7},
		},
		"placed more than counted": {
			{PlacementId: rack, Quantity: 9},
		},
	} {
		_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: warehouse, RequestId: req.GetId(),
			Lines: []*inventoryv1.RestockRequestReceivedLine{
				{ItemId: req.GetItems()[0].GetId(), ReceivedCount: 8, Placements: placements},
			},
		}))
		if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
			t.Fatalf("%s = %v, want InvalidArgument", name, code)
		}
	}

	// The same shelf twice is refused too: that is one placement written down twice, and adding them
	// together is not the same as the person having meant it.
	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: req.GetItems()[0].GetId(), ReceivedCount: 8,
				Placements: []*inventoryv1.RestockPlacement{
					{PlacementId: rack, Quantity: 5},
					{PlacementId: rack, Quantity: 3},
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
// with their note and value so the loss is a number somebody can total, but they are never on-hand —
// stock that cannot be sold is stock that fails at the shelf, in front of a customer.
//
// any-warehouse-member-counts-what-arrived: the warehouse types what was IN THE BOX — broken included — and how many
// of those are broken. received_count reads back 10, not the 8 sellable.
func TestRestockRequest_AcceptRecordsDamageWithoutStockingIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rack := insertRack(t, db, warehouse, "A-01-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 100000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	ful, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: req.GetItems()[0].GetId(),
				// What was in the box: 10 turned up, 2 of them broken — so 8 go to the shelf.
				ReceivedCount: 10,
				BrokenCount:   2,
				BrokenNote:    "crushed in transit",
				Placements:    placedOn(rack, 8),
			},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// The response, then a FRESH read — the response is built from the handler's own struct.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: sellingTeam, RequestId: req.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	for source, item := range map[string]*inventoryv1.RestockRequestItem{
		"response": ful.Msg.GetRequest().GetItems()[0],
		"stored":   detail.Msg.GetRequest().GetItems()[0],
	} {
		if got := item.GetReceivedCount(); got != 10 {
			t.Fatalf("%s: received = %d, want 10 — what was in the box, broken included", source, got)
		}

		problems := item.GetProblems()
		if len(problems) != 1 {
			t.Fatalf("%s: recorded %d problem rows, want 1", source, len(problems))
		}
		if problems[0].GetCount() != 2 || problems[0].GetType() != broken {
			t.Fatalf("%s: problem row = %+v, want 2 units, broken", source, problems[0])
		}
		if problems[0].GetNote() != "crushed in transit" {
			t.Fatalf("%s: the note = %q — the warehouse's words were dropped", source, problems[0].GetNote())
		}

		// the-problem-price-is-filled-by-the-system: the line's share, 100.000 × 2 ÷ 10.
		if problems[0].GetPriceUnit() != 10000 || problems[0].GetTotal() != 20000 {
			t.Fatalf("%s: problem worth %d / %d, want 10000 / 20000", source,
				problems[0].GetPriceUnit(), problems[0].GetTotal())
		}
	}

	// 8 ON THE SHELF, NOT 10. This is the assertion the whole decision rests on: the broken pair must
	// not be pickable.
	if got := onHandAt(t, db, warehouse, 100, &rack); got != 8 {
		t.Fatalf("the shelf holds %d, want 8 — the damaged units entered stock", got)
	}
}

// any-warehouse-member-counts-what-arrived: broken units are AMONG those that arrived, so more broken than received is
// a count that cannot be true — refused, moving nothing. a-broken-reason-is-optional: a count of broken units with no
// note still goes through.
func TestRestockRequest_AcceptBrokenIsCountedOutOfReceived(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	rack := insertRack(t, db, warehouse, "A-01-1")

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 100000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	itemID := req.GetItems()[0].GetId()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: itemID, ReceivedCount: 3, BrokenCount: 4},
		},
	}))
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("broken above received = %v, want InvalidArgument", code)
	}

	if got := onHandAt(t, db, warehouse, 100, &rack); got != 0 {
		t.Fatalf("a refused count moved %d units onto the shelf", got)
	}

	// No note at all — the accept is never held up for one.
	ful, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: itemID, ReceivedCount: 10, BrokenCount: 2, Placements: placedOn(rack, 8)},
		},
	}))
	if err != nil {
		t.Fatalf("broken with no note must be accepted: %v", err)
	}

	problems := ful.Msg.GetRequest().GetItems()[0].GetProblems()
	if len(problems) != 1 || problems[0].GetType() != broken || problems[0].GetCount() != 2 {
		t.Fatalf("problems = %v, want one broken row of 2", problems)
	}
}

// onHandAt reads what one PLACE holds. `rack == nil` asks for stock on NO placement — which must always be 0 now
// (there-is-no-unplaced-pile) — and IS NOT DISTINCT FROM is what makes that question honest: `rack_id = NULL` is never
// true in SQL, so the ordinary comparison would report a rack-less row as empty however much sat in it (#135).
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
	//
	// ⚠ a-product-appears-once-per-restock forbids this for a NEW restock, but nothing refuses it yet (the unique
	// (restock, product) key lands with the backend step), and rows written before the decision can hold it — so the
	// filter must still return such a restock once.
	twice, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: wanted, Sku: "SKU1", Name: "Widget", Count: 3, Total: 3000},
			{ProductId: wanted, Sku: "SKU1", Name: "Widget", Count: 2, Total: 2000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: other, Sku: "SKU2", Name: "Gadget", Count: 1, Total: 500},
		},
	}))
	if err != nil {
		t.Fatalf("create other: %v", err)
	}

	res, err := svc.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: warehouse,
		Filter: &inventoryv1.RestockRequestListFilter{ProductId: wanted},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("RestockRequestList: %v", err)
	}

	got := requestRows(res.Msg)
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
		TeamId: warehouse, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("unfiltered list: %v", err)
	}
	if len(requestRows(unfiltered.Msg)) != 2 {
		t.Fatalf("unfiltered list holds %d requests, want 2", len(requestRows(unfiltered.Msg)))
	}
}
