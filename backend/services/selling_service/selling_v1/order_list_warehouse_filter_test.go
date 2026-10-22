package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// courierOrder places an order for `teamID` on `shopID`, with a courier and `qty` units over two lines.
func courierOrder(t *testing.T, svc *selling_v1.Service, teamID, shopID uint64, courier string, qty uint32) uint64 {
	t.Helper()

	resp, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: teamID, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", ShippingCode: courier, Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: qty, UnitPrice: 5000},
			{ProductId: 2, Sku: "SKU2", Name: "Gadget", Quantity: 1, UnitPrice: 5000},
		},
	}))
	if err != nil {
		t.Fatalf("place order for team %d: %v", teamID, err)
	}

	return resp.Msg.GetOrder().GetId()
}

// THE WAREHOUSE'S THREE FILTERS (the-filter-gains-seller-marketplace-and-courier) — read from the warehouse's end,
// where every seller's orders meet: seller team, marketplace (the order's shop is on it), courier.
func TestOrderList_TheWarehouseFiltersBySellerMarketplaceAndCourier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melatiShopee := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")
	melatiTiktok := insertShop(t, db, 2, "Melati TikTok", "MEL-T", "tiktok")
	kenangaShopee := insertShop(t, db, 3, "Kenanga Shopee", "KEN-S", "shopee")

	a := courierOrder(t, svc, 2, melatiShopee, "jne", 1)
	b := courierOrder(t, svc, 2, melatiTiktok, "jnt", 1)
	c := courierOrder(t, svc, 3, kenangaShopee, "jne", 1)

	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{}), a, b, c)
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{SellerTeamId: 3}), c)
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{
		Marketplace: marketplacev1.Marketplace_MARKETPLACE_SHOPEE,
	}), a, c)
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{ShippingCode: "jne"}), a, c)

	// They compose.
	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{
		SellerTeamId: 2, Marketplace: marketplacev1.Marketplace_MARKETPLACE_SHOPEE, ShippingCode: "jne",
	}), a)

	// The seller's own list takes them too: a seller filtering its orders by marketplace.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		Marketplace: marketplacev1.Marketplace_MARKETPLACE_TIKTOK,
	}), b)
}

// The strip above the list counts exactly the rows below it: the stat takes the same three filters.
func TestOrderStat_TakesTheWarehouseFilters(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melatiShopee := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")
	kenangaShopee := insertShop(t, db, 3, "Kenanga Shopee", "KEN-S", "shopee")

	courierOrder(t, svc, 2, melatiShopee, "jne", 1)
	courierOrder(t, svc, 3, kenangaShopee, "jnt", 1)
	courierOrder(t, svc, 3, kenangaShopee, "jne", 1)

	pending := func(filter *sellingv1.OrderStatFilter) int64 {
		t.Helper()

		res, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
			TeamId: testWarehouse, Filter: filter,
		}))
		if err != nil {
			t.Fatalf("OrderStat(%v): %v", filter, err)
		}

		for _, row := range res.Msg.GetByStatus() {
			if row.GetStatus() == sellingv1.OrderStatus_ORDER_STATUS_PENDING {
				return row.GetCount()
			}
		}

		return 0
	}

	if got := pending(&sellingv1.OrderStatFilter{SellerTeamId: 3}); got != 2 {
		t.Fatalf("pending for seller team 3 = %d, want 2", got)
	}

	if got := pending(&sellingv1.OrderStatFilter{ShippingCode: "jne"}); got != 2 {
		t.Fatalf("pending for courier jne = %d, want 2", got)
	}

	if got := pending(&sellingv1.OrderStatFilter{Marketplace: marketplacev1.Marketplace_MARKETPLACE_TIKTOK}); got != 0 {
		t.Fatalf("pending on TikTok = %d, want 0 — no shop here is on TikTok", got)
	}
}

// THE ROW CARRIES ITS UNIT COUNT (the-warehouse-row-fills-from-shop-and-user-by-ids) — the sum of the lines'
// quantities, without the lines themselves. The detail, which has the lines, says the same.
func TestOrderList_TheRowCarriesItsUnitCount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")
	orderID := courierOrder(t, svc, 2, shop, "jne", 4) // 4 + 1

	rows := orderRows(listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{}))
	if len(rows) != 1 || rows[0].GetItemQuantity() != 5 {
		t.Fatalf("rows %+v — want one row carrying 5 units", rows)
	}

	if len(rows[0].GetItems()) != 0 {
		t.Fatalf("the list sent %d lines — it carries the count, never the lines", len(rows[0].GetItems()))
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetItemQuantity(); got != 5 {
		t.Fatalf("detail item_quantity = %d, want 5", got)
	}
}
