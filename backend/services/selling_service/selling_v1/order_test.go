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
		TeamId: 2, ShopId: shopID,
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
		TeamId: 2, ShopId: shopID,
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

func TestOrder_CreateShopNotInTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopID := insertShop(t, db, 2, "Shop", "S2", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 3, ShopId: shopID, CustomerName: "X", Subtotal: 1, Total: 1,
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
			TeamId: 2, ShopId: shopID, CustomerName: name, Subtotal: 100, Total: 100,
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
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("OrderList: %v", err)
	}
	if len(lst.Msg.GetOrders()) != 2 {
		t.Fatalf("orders = %d, want 2", len(lst.Msg.GetOrders()))
	}
	if len(lst.Msg.GetOrders()[0].GetItems()) != 0 {
		t.Fatalf("list should not carry items")
	}

	// Another team cannot read the order.
	_, err = svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 3, OrderId: id1}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team detail code = %v, want NotFound", connect.CodeOf(err))
	}
}
