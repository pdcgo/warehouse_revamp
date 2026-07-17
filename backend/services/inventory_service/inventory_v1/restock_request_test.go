package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

const (
	pending   = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_PENDING
	fulfilled = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_FULFILLED
	cancelled = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED
)

func TestRestockRequest_CreateListFulfil(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, Price: 5000},
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

	// A non-target warehouse cannot fulfil it (reads as NotFound).
	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{TeamId: 9, RequestId: reqID}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-warehouse fulfil code = %v, want NotFound", connect.CodeOf(err))
	}

	// The target warehouse fulfils: status FULFILLED and the stock is received.
	ful, err := svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{TeamId: warehouse, RequestId: reqID}))
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
	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{TeamId: warehouse, RequestId: reqID}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("re-fulfil code = %v, want FailedPrecondition", connect.CodeOf(err))
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
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2, Price: 1500},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Quantity: 5, Price: 700},
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
		if got.GetReceipt() != "JP99" || got.GetItems()[1].GetPrice() != 700 {
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
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 3, Price: 4000},
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
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, Price: 100},
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
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 4, Price: 5000},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Quantity: 7, Price: 12500},
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
	if got.GetItems()[1].GetPrice() != 12500 || got.GetItems()[1].GetSku() != "SKU2" {
		t.Fatalf("line did not round-trip: %+v", got.GetItems()[1])
	}

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: got.GetId(),
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
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, Price: 100},
			},
		}))

		return err
	}

	// Our own supplier is fine, and the optional context round-trips.
	resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5, SupplierId: mine,
		OrderRef: "SHP-77", Receipt: "JP1234567890",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, Price: 100},
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
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2, Price: 900},
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
