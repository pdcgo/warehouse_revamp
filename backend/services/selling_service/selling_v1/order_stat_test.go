package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// orderStat is the call under test.
func orderStat(t *testing.T, svc *selling_v1.Service, teamID, productID uint64) *sellingv1.OrderStatResponse {
	t.Helper()

	res, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: teamID,
		Filter: &sellingv1.OrderStatFilter{ProductId: productID},
	}))
	if err != nil {
		t.Fatalf("OrderStat(team=%d, product=%d): %v", teamID, productID, err)
	}

	return res.Msg
}

// statusCount reads one status out of the census. A status with no orders is ABSENT from the
// response by design, so this reports (0, 0) for it rather than failing — which is what lets a test
// assert "cancelled is empty" the same way it asserts "placed has two".
func statusCount(
	res *sellingv1.OrderStatResponse,
	status sellingv1.OrderStatus,
) (count int64, value int64) {
	for _, row := range res.GetByStatus() {
		if row.GetStatus() == status {
			return row.GetCount(), row.GetValue()
		}
	}

	return 0, 0
}

// cancel is the tail this stat has to treat differently from every other status.
func cancel(t *testing.T, svc *selling_v1.Service, teamID, orderID uint64) {
	t.Helper()

	_, err := svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: teamID, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("cancel order %d: %v", orderID, err)
	}
}

// The census counts every status separately, and each carries the money sitting in it.
func TestOrderStat_CountsAndValuesEachStatus(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	placeOrder(t, svc, 2, shop) // PLACED, 10_000
	placeOrder(t, svc, 2, shop) // PLACED, 10_000
	confirmedOrder(t, svc, shop)

	got := orderStat(t, svc, 2, 0)

	placedCount, placedValue := statusCount(got, sellingv1.OrderStatus_ORDER_STATUS_PLACED)
	if placedCount != 2 {
		t.Fatalf("placed count = %d, want 2", placedCount)
	}
	if placedValue != 20_000 {
		t.Fatalf("placed value = %d, want 20000", placedValue)
	}

	confirmedCount, _ := statusCount(got, sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED)
	if confirmedCount != 1 {
		t.Fatalf("confirmed count = %d, want 1", confirmedCount)
	}

	// A status nobody is in is absent, not a zero row — the contract says so, and the frontend renders
	// the gaps from the enum it already knows.
	for _, row := range got.GetByStatus() {
		if row.GetStatus() == sellingv1.OrderStatus_ORDER_STATUS_CANCELLED {
			t.Fatalf("cancelled has a row with no cancelled orders: %v", row)
		}
	}
}

// A cancelled order is still SOMEWHERE — it holds a place in the census — but it is not money the
// team took. This is the one rule the two halves of the response disagree on, so it is pinned.
func TestOrderStat_CancelledCountsInTheCensusButNotTheRevenue(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	kept := placeOrder(t, svc, 2, shop)
	dropped := placeOrder(t, svc, 2, shop)

	cancel(t, svc, 2, dropped)

	got := orderStat(t, svc, 2, 0)

	cancelledCount, cancelledValue := statusCount(got, sellingv1.OrderStatus_ORDER_STATUS_CANCELLED)
	if cancelledCount != 1 {
		t.Fatalf("cancelled count = %d, want 1", cancelledCount)
	}
	if cancelledValue != 10_000 {
		t.Fatalf("cancelled value = %d, want 10000 — the census reports what is there", cancelledValue)
	}

	// The surviving order is the ONLY one in the money.
	if got.GetPreview().GetOrders_30D() != 1 {
		t.Fatalf("orders_30d = %d, want 1 (order %d only)", got.GetPreview().GetOrders_30D(), kept)
	}
	if got.GetPreview().GetRevenue_30D() != 10_000 {
		t.Fatalf("revenue_30d = %d, want 10000", got.GetPreview().GetRevenue_30D())
	}
}

// The stat describes the SAME set of orders OrderList does — both sides of it. A warehouse's header
// must count the queue it can actually see, or the number above the table contradicts the table.
func TestOrderStat_TheWarehouseSeesTheOrdersShippingFromIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	confirmedOrder(t, svc, shop)

	got := orderStat(t, svc, testWarehouse, 0)

	confirmedCount, _ := statusCount(got, sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED)
	if confirmedCount != 1 {
		t.Fatalf("the warehouse's confirmed count = %d, want 1", confirmedCount)
	}

	// And a team on neither end of the order counts nothing at all.
	const strangerTeam uint64 = 902

	stranger := orderStat(t, svc, strangerTeam, 0)
	if len(stranger.GetByStatus()) != 0 {
		t.Fatalf("an unrelated team's census has %d rows, want 0", len(stranger.GetByStatus()))
	}
	if stranger.GetPreview().GetOrders_30D() != 0 {
		t.Fatalf("an unrelated team's orders_30d = %d, want 0", stranger.GetPreview().GetOrders_30D())
	}
}

// The product filter narrows the stat exactly as it narrows the list. Without this the header would
// describe the whole team while the table showed one product's orders.
func TestOrderStat_ProductFilterNarrowsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	placeOrder(t, svc, 2, shop)  // product 1
	confirmedOrder(t, svc, shop) // product 100 (orderReq)

	onlyProduct1 := orderStat(t, svc, 2, 1)

	placedCount, _ := statusCount(onlyProduct1, sellingv1.OrderStatus_ORDER_STATUS_PLACED)
	if placedCount != 1 {
		t.Fatalf("product 1 placed count = %d, want 1", placedCount)
	}

	confirmedCount, _ := statusCount(onlyProduct1, sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED)
	if confirmedCount != 0 {
		t.Fatalf("product 1 confirmed count = %d, want 0 — that order carries product 100", confirmedCount)
	}

	if onlyProduct1.GetPreview().GetOrders_30D() != 1 {
		t.Fatalf("product 1 orders_30d = %d, want 1", onlyProduct1.GetPreview().GetOrders_30D())
	}
}

// The marketplace total is a NOTE (owner): stored as typed, and no arithmetic anywhere touches it.
//
// Pinned as a test rather than a comment because the temptation is structural — it is a money field
// on an order, sitting beside three others that ARE summed, and the first reader to "fix" the total
// by folding it in would be counting the same sale twice.
func TestOrderCreate_MarketplaceTotalIsANoteNotATerm(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	res, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shop, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		Subtotal:     10_000,
		ShippingCost: 5_000,
		Total:        15_000,
		// What the storefront actually took — deliberately unrelated to the sum above.
		MarketplaceTotal: 58_000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10_000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate: %v", err)
	}

	order := res.Msg.GetOrder()

	if order.GetMarketplaceTotal() != 58_000 {
		t.Fatalf("marketplace_total = %d, want 58000 — stored exactly as typed",
			order.GetMarketplaceTotal())
	}

	// The sum is untouched by it.
	if order.GetTotal() != 15_000 {
		t.Fatalf("total = %d, want 15000 (subtotal + shipping) — the marketplace note must not enter it",
			order.GetTotal())
	}

	// And it survives a re-read, rather than living only in the create response.
	got := orderStat(t, svc, 2, 0)
	if got.GetPreview().GetRevenue_30D() != 15_000 {
		t.Fatalf("revenue_30d = %d, want 15000 — revenue counts `total`, never the marketplace note",
			got.GetPreview().GetRevenue_30D())
	}
}
