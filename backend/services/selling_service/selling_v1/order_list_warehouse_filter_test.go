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
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                teamID, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", ShippingCode: courier,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: qty},
			{ProductId: 2, Sku: "SKU2", Name: "Gadget", Quantity: 1},
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

// THE SELLER LIST'S WAREHOUSE FILTER — "only the ones leaving Gudang Pusat": the list and the strip above it narrow
// together, and a warehouse naming ANOTHER warehouse reads nothing rather than reaching orders it does not ship.
func TestOrderList_TheSellerFiltersByWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	const otherWarehouse uint64 = 901

	here := courierOrder(t, svc, 2, shop, "jne", 1)

	req := feeOrderReq(shop)
	req.WarehouseId = otherWarehouse

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create at the other warehouse: %v", err)
	}

	there := created.Msg.GetOrder().GetId()

	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{}), here, there)
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{WarehouseId: otherWarehouse}), there)

	stat, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: 2, Filter: &sellingv1.OrderStatFilter{WarehouseId: otherWarehouse},
	}))
	if err != nil {
		t.Fatalf("OrderStat: %v", err)
	}

	if got := pendingRow(t, stat.Msg).GetCount(); got != 1 {
		t.Fatalf("the strip counts %d pending for the other warehouse, want 1 — the row below it", got)
	}

	wantOrders(t, listFiltered(t, svc, testWarehouse, &sellingv1.OrderListFilter{WarehouseId: otherWarehouse}))
}

// WHEN IT ENTERED ITS STATUS (a-filtered-status-shows-its-own-date): a fresh order dates its pending from when it was
// placed; once moved, the row carries the move's own moment — the list and the detail agree.
func TestOrderList_TheRowCarriesWhenItEnteredItsStatus(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	id := courierOrder(t, svc, 2, shop, "jne", 1)

	rows := orderRows(listFiltered(t, svc, 2, &sellingv1.OrderListFilter{}))
	if len(rows) != 1 || rows[0].GetStatusAtUnix() == 0 || rows[0].GetStatusAtUnix() != rows[0].GetCreatedAtUnix() {
		t.Fatalf("rows %+v — a pending order entered pending when it was placed", rows)
	}

	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	var movedAt int64

	for _, log := range detail.Msg.GetOrder().GetTimelineLogs() {
		if log.GetStatus() == sellingv1.OrderStatus_ORDER_STATUS_PROCESSED {
			movedAt = log.GetCreatedAtUnix()
		}
	}

	rows = orderRows(listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Status: sellingv1.OrderStatus_ORDER_STATUS_PROCESSED}))
	if len(rows) != 1 || movedAt == 0 || rows[0].GetStatusAtUnix() != movedAt {
		t.Fatalf("rows %+v — want the processed move's own moment %d", rows, movedAt)
	}

	if got := detail.Msg.GetOrder().GetStatusAtUnix(); got != movedAt {
		t.Fatalf("detail status_at = %d, want %d — the same as the list", got, movedAt)
	}
}
