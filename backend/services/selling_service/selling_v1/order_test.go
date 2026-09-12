package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestOrder_CreateThenDetail(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")

	created, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", CustomerPhone: "0812-000",
		Address: &sellingv1.OrderAddress{
			ProvinsiCode: "11", ProvinsiName: "Aceh",
			KabupatenCode: "11.01", KabupatenName: "Kabupaten Aceh Selatan",
			KecamatanCode: "11.01.01", KecamatanName: "Bakongan",
			DesaCode: "11.01.01.2001", DesaName: "Keude Bakongan",
			KodePos: "23773", AddressLine: "Jl. Test 1",
		},
		ShippingCode: "jne", Subtotal: 20000, ShippingCost: 5000, Total: 25000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate: %v", err)
	}
	if created.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PLACED {
		t.Fatalf("new order status = %v, want PLACED", created.Msg.GetOrder().GetStatus())
	}

	id := created.Msg.GetOrder().GetId()

	resp, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	// The address is FROZEN onto the order — codes AND names — so a past order renders without
	// region_service and survives the desa being renamed or merged (#118).
	addr := resp.Msg.GetOrder().GetAddress()
	if addr.GetProvinsiName() != "Aceh" || addr.GetKabupatenName() != "Kabupaten Aceh Selatan" ||
		addr.GetKecamatanName() != "Bakongan" || addr.GetDesaName() != "Keude Bakongan" {
		t.Fatalf("address names did not round-trip: %+v", addr)
	}
	if addr.GetDesaCode() != "11.01.01.2001" || addr.GetKodePos() != "23773" ||
		addr.GetAddressLine() != "Jl. Test 1" {
		t.Fatalf("address codes/detail did not round-trip: %+v", addr)
	}

	got := resp.Msg.GetOrder()
	if got.GetCustomerName() != "Budi" || got.GetTotal() != 25000 || got.GetShopId() != shopID {
		t.Fatalf("unexpected order: %+v", got)
	}
	if len(got.GetItems()) != 1 || got.GetItems()[0].GetSku() != "SKU1" || got.GetItems()[0].GetQuantity() != 2 {
		t.Fatalf("unexpected items: %+v", got.GetItems())
	}
}

// You can only order through your own team's shop.
// An order with no address is allowed — exactly as the free text it replaced was optional. It comes
// back as an EMPTY address, never nil, so a client renders it without null-checking.
func TestOrder_CreateWithoutAddress(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S-NOADDR", "shopee")

	created, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Tanpa Alamat", ShippingCode: "jne",
		Subtotal: 10000, ShippingCost: 0, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate without an address: %v", err)
	}

	addr := created.Msg.GetOrder().GetAddress()
	if addr == nil {
		t.Fatal("address should be an empty message, not nil")
	}

	if addr.GetProvinsiCode() != "" || addr.GetAddressLine() != "" {
		t.Fatalf("expected an empty address, got %+v", addr)
	}
}

// The note is carried through VERBATIM and read back by OrderDetail — it is the one field on an
// order that nothing in the system interprets, so the whole contract is "what was typed is what
// comes back", newlines included. An order without one reads as "", never nil.
func TestOrder_CreateWithNote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S-NOTE", "shopee")

	const note = "Kirim setelah jam 5 sore.\nBungkus yang kaca."

	created, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", Note: note,
		Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate with a note: %v", err)
	}

	if created.Msg.GetOrder().GetNote() != note {
		t.Fatalf("note on create = %q, want %q", created.Msg.GetOrder().GetNote(), note)
	}

	resp, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	if resp.Msg.GetOrder().GetNote() != note {
		t.Fatalf("note on detail = %q, want %q", resp.Msg.GetOrder().GetNote(), note)
	}

	// No note is "" rather than anything else — every order predating the column is in that state.
	plain, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Tanpa Catatan", Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate without a note: %v", err)
	}

	if plain.Msg.GetOrder().GetNote() != "" {
		t.Fatalf("note with none given = %q, want empty", plain.Msg.GetOrder().GetNote())
	}
}

// THE MARKETPLACE'S OWN ID for the order (owner) — stored verbatim, carried back out unchanged, and
// findable by the free-text search. That last part is the point of the field: the reference is what a
// buyer quotes and what a payout report lists, so an order that could only be found by customer name
// would leave the number nobody can act on.
func TestOrder_CreateWithExternalRef(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S-REF", "shopee")

	// The shape a marketplace reference actually arrives in — mixed case and digits, no structure we
	// could have predicted, which is why nothing here parses it.
	const ref = "250815ABCD1234"

	created, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", OrderExternalRefId: ref,
		Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate with an external ref: %v", err)
	}

	if created.Msg.GetOrder().GetOrderExternalRefId() != ref {
		t.Fatalf("ref on create = %q, want %q", created.Msg.GetOrder().GetOrderExternalRefId(), ref)
	}

	resp, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	if resp.Msg.GetOrder().GetOrderExternalRefId() != ref {
		t.Fatalf("ref on detail = %q, want %q", resp.Msg.GetOrder().GetOrderExternalRefId(), ref)
	}

	// An order taken over the phone has NO marketplace reference, and "" is how it says so — not a
	// placeholder, and nothing to back-fill.
	phone, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Lewat Telepon", Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate without an external ref: %v", err)
	}

	if phone.Msg.GetOrder().GetOrderExternalRefId() != "" {
		t.Fatalf("ref with none given = %q, want empty", phone.Msg.GetOrder().GetOrderExternalRefId())
	}

	// SEARCHABLE BY IT — a partial term, because somebody reading a reference off a chat message
	// quotes the tail of it as often as the whole thing.
	found, err := svc.OrderList(ctx, connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: 2,
		Filter: &sellingv1.OrderListFilter{Search: "ABCD"},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 10},
	}))
	if err != nil {
		t.Fatalf("OrderList by ref: %v", err)
	}

	rows := orderRows(found.Msg)
	if len(rows) != 1 {
		t.Fatalf("search by ref returned %d orders, want 1 — the phone order has no ref to match",
			len(rows))
	}

	if rows[0].GetId() != created.Msg.GetOrder().GetId() {
		t.Fatalf("search by ref found order %d, want %d",
			rows[0].GetId(), created.Msg.GetOrder().GetId())
	}
}

// The shipping receipt is a REFERENCE to a document_service document, snapshotted with its label —
// so an order can be rendered without calling document_service, and the bytes stay where they are.
// An order with none carries an empty receipt message rather than nil.
func TestOrder_CreateWithReceipt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S-RECEIPT", "shopee")

	receipt := &sellingv1.OrderReceipt{
		DocumentId: "doc-abc-123",
		Filename:   "resi-jne.pdf",
		MimeType:   "application/pdf",
	}

	created, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", Receipt: receipt,
		Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate with a receipt: %v", err)
	}

	resp, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	got := resp.Msg.GetOrder().GetReceipt()
	if got.GetDocumentId() != receipt.GetDocumentId() ||
		got.GetFilename() != receipt.GetFilename() ||
		got.GetMimeType() != receipt.GetMimeType() {
		t.Fatalf("receipt did not round-trip: %+v", got)
	}

	// No receipt is an EMPTY message, never nil — the same convention the address follows.
	plain, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Tanpa Resi", Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate without a receipt: %v", err)
	}

	none := plain.Msg.GetOrder().GetReceipt()
	if none == nil {
		t.Fatal("receipt should be an empty message, not nil")
	}

	if none.GetDocumentId() != "" {
		t.Fatalf("expected no receipt, got %+v", none)
	}
}

func TestOrder_CreateShopNotInTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopID := insertShop(t, db, 2, "Shop", "S2", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 3, ShopId: shopID, WarehouseId: testWarehouse, CustomerName: "X", Subtotal: 1, Total: 1,
		Items: []*sellingv1.OrderItem{{ProductId: 1, Sku: "S", Name: "N", Quantity: 1, UnitPrice: 1}},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team create code = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestOrder_ListScopedAndCrossTeamDetail(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S3", "shopee")

	create := func(name string) uint64 {
		r, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
			TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse, CustomerName: name, Subtotal: 100, Total: 100,
			Items: []*sellingv1.OrderItem{{ProductId: 1, Sku: "S", Name: "N", Quantity: 1, UnitPrice: 100}},
		}))
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return r.Msg.GetOrder().GetId()
	}

	id1 := create("A")
	create("B")

	// Team 2 sees both; the list is a summary (no items).
	lst, err := svc.OrderList(ctx, connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("OrderList: %v", err)
	}
	if len(orderRows(lst.Msg)) != 2 {
		t.Fatalf("orders = %d, want 2", len(orderRows(lst.Msg)))
	}
	if len(orderRows(lst.Msg)[0].GetItems()) != 0 {
		t.Fatalf("list should not carry items")
	}

	// Another team cannot read the order.
	_, err = svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 3, OrderId: id1}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team detail code = %v, want NotFound", connect.CodeOf(err))
	}
}

// #72 — an order names the warehouse that fulfils it, chosen per order and stored rather than
// inferred. It round-trips, and an order that names none is refused: from #69 this id is what stock
// is deducted FROM, so an order without one is one the system cannot honour.
func TestOrderCreate_NamesItsWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shop, WarehouseId: testWarehouse,
		CustomerName: "Budi", Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got := created.Msg.GetOrder().GetWarehouseId(); got != testWarehouse {
		t.Fatalf("warehouse did not round-trip on create: %d, want %d", got, testWarehouse)
	}

	// And it is STORED, not just echoed — read it back through Detail.
	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetWarehouseId(); got != testWarehouse {
		t.Fatalf("warehouse as STORED = %d, want %d", got, testWarehouse)
	}

	// An order that names no warehouse is refused. Proto validation rejects it at the boundary, but
	// unit tests bypass the interceptor — which is exactly why the handler re-checks.
	_, err = svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shop,
		CustomerName: "Budi", Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("an order with no warehouse = %v, want InvalidArgument", code)
	}
}
