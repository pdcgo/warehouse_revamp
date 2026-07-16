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
			OrderId: 77, Receipt: "JP1234567890",
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, Price: 100},
			},
		}))

		return err
	}

	// Our own supplier is fine, and the optional context round-trips.
	resp, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: 5, SupplierId: mine,
		OrderId: 77, Receipt: "JP1234567890",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, Price: 100},
		},
	}))
	if err != nil {
		t.Fatalf("create with own supplier: %v", err)
	}
	if got := resp.Msg.GetRequest(); got.GetSupplierId() != mine || got.GetOrderId() != 77 ||
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
	if got.GetSupplierId() != 0 || got.GetOrderId() != 0 || got.GetReceipt() != "" {
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
