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

	placeOrder(t, svc, 2, shop) // PENDING, the buyer paid testPlatformTotal
	placeOrder(t, svc, 2, shop) // PENDING, the same
	processedOrder(t, svc, shop)

	got := orderStat(t, svc, 2, 0)

	placedCount, placedValue := statusCount(got, sellingv1.OrderStatus_ORDER_STATUS_PENDING)
	if placedCount != 2 {
		t.Fatalf("placed count = %d, want 2", placedCount)
	}
	// The value is what the buyers paid — Σ platform_total.
	if placedValue != 2*testPlatformTotal {
		t.Fatalf("placed value = %d, want %d — what the two buyers paid", placedValue, 2*testPlatformTotal)
	}

	confirmedCount, _ := statusCount(got, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
	if confirmedCount != 1 {
		t.Fatalf("confirmed count = %d, want 1", confirmedCount)
	}

	// A status nobody is in is absent, not a zero row — the contract says so, and the frontend renders
	// the gaps from the enum it already knows.
	for _, row := range got.GetByStatus() {
		if row.GetStatus() == sellingv1.OrderStatus_ORDER_STATUS_CANCEL {
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

	cancelledCount, cancelledValue := statusCount(got, sellingv1.OrderStatus_ORDER_STATUS_CANCEL)
	if cancelledCount != 1 {
		t.Fatalf("cancelled count = %d, want 1", cancelledCount)
	}
	if cancelledValue != testPlatformTotal {
		t.Fatalf("cancelled value = %d, want %d — the census reports what is there", cancelledValue, testPlatformTotal)
	}

	// The surviving order is the ONLY one in the money.
	if got.GetPreview().GetOrders_30D() != 1 {
		t.Fatalf("orders_30d = %d, want 1 (order %d only)", got.GetPreview().GetOrders_30D(), kept)
	}
	if got.GetPreview().GetRevenue_30D() != testPlatformTotal {
		t.Fatalf("revenue_30d = %d, want %d", got.GetPreview().GetRevenue_30D(), testPlatformTotal)
	}
}

// The stat describes the SAME set of orders OrderList does — both sides of it. A warehouse's header
// must count the queue it can actually see, or the number above the table contradicts the table.
func TestOrderStat_TheWarehouseSeesTheOrdersShippingFromIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	processedOrder(t, svc, shop)

	got := orderStat(t, svc, testWarehouse, 0)

	confirmedCount, _ := statusCount(got, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
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
	processedOrder(t, svc, shop) // product 100 (orderReq)

	onlyProduct1 := orderStat(t, svc, 2, 1)

	placedCount, _ := statusCount(onlyProduct1, sellingv1.OrderStatus_ORDER_STATUS_PENDING)
	if placedCount != 1 {
		t.Fatalf("product 1 placed count = %d, want 1", placedCount)
	}

	confirmedCount, _ := statusCount(onlyProduct1, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
	if confirmedCount != 0 {
		t.Fatalf("product 1 confirmed count = %d, want 0 — that order carries product 100", confirmedCount)
	}

	if onlyProduct1.GetPreview().GetOrders_30D() != 1 {
		t.Fatalf("product 1 orders_30d = %d, want 1", onlyProduct1.GetPreview().GetOrders_30D())
	}
}

// THE PLATFORM TOTAL IS WHAT THE BUYER PAID (the-total-is-ours-the-platform-total-is-theirs): stored as typed, never a
// term of our own figures — goods_cost and total_cost are the take's and the warehouse's — and it is what the census's
// revenue counts, since selling 00027 dropped the order's own `total`.
func TestOrderCreate_ThePlatformTotalIsWhatTheBuyerPaid(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	res, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		PlatformCreatedAtUnix: testPlatformDate,
		TeamId:                2, ShopId: shop, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		// What the storefront actually took.
		PlatformTotal: 58_000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate: %v", err)
	}

	order := res.Msg.GetOrder()

	if order.GetPlatformTotal() != 58_000 {
		t.Fatalf("platform_total = %d, want 58000 — stored exactly as typed",
			order.GetPlatformTotal())
	}

	// Our own figures are untouched by it: the picker knew no cost, so the goods cost is unknown, not 58.000.
	if order.GetGoodsCost() != 0 || order.GetTotalCost() != 0 {
		t.Fatalf("goods_cost %d, total_cost %v — want 0 and 0: what the buyer paid is not our cost",
			order.GetGoodsCost(), order.GetTotalCost())
	}

	// And it survives a re-read, rather than living only in the create response.
	got := orderStat(t, svc, 2, 0)
	if got.GetPreview().GetRevenue_30D() != 58_000 {
		t.Fatalf("revenue_30d = %d, want 58000 — revenue counts what the buyer paid",
			got.GetPreview().GetRevenue_30D())
	}
}

// pendingRow is the census's pending row, failing when there is none.
func pendingRow(t *testing.T, res *sellingv1.OrderStatResponse) *sellingv1.OrderStatusCount {
	t.Helper()

	for _, row := range res.GetByStatus() {
		if row.GetStatus() == sellingv1.OrderStatus_ORDER_STATUS_PENDING {
			return row
		}
	}

	t.Fatalf("no pending row in %v", res.GetByStatus())

	return nil
}

// THE SUMMARY'S UNITS AND THE MARGIN'S INPUTS (the-summary-follows-the-tab, the-margin-is-mp-minus-total-beli): the units
// are every order's, while the platform value, the cost and the fees cover only the orders the margin can be taken
// over — and the census says how many it left out, one per missing fact.
func TestOrderStat_SumsTheUnitsAndTheMeasurableOrdersMoney(t *testing.T) {
	db := san_testdb.DB(t)
	priced := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	unpriced := newServiceWithFees(t, db, knownCosts(), nil)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	place := func(svc *selling_v1.Service, req *sellingv1.OrderCreateRequest) {
		t.Helper()

		_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
		if err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	// Measurable: cost 14.000, the platform's 25.000, a frozen fee of 350. 3 units.
	measured := feeOrderReq(shop)
	measured.PlatformTotal = 25000
	place(priced, measured)

	// No platform figure. 3 units. Placement refuses that now (platform-total-is-required-at-finalize), so this is an
	// order placed BEFORE the rule — written with a figure and then taken back to the 0 such an order carries.
	legacy, err := priced.OrderCreate(context.Background(), connect.NewRequest(feeOrderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	err = db.Exec("UPDATE orders SET platform_total = 0 WHERE id = ?", legacy.Msg.GetOrder().GetId()).Error
	if err != nil {
		t.Fatalf("take the figure back: %v", err)
	}

	// No known cost — product 3 is unknown to the picker, so goods_cost is 0. 1 unit.
	unknownCost := feeOrderReq(shop)
	unknownCost.PlatformTotal = 20000
	unknownCost.Items = []*sellingv1.OrderItem{{ProductId: 3, Sku: "SKU3", Name: "Mystery", Quantity: 1}}
	place(priced, unknownCost)

	// Never priced: cost and platform figure both known, but no fee was frozen. 3 units.
	neverPriced := feeOrderReq(shop)
	neverPriced.PlatformTotal = 30000
	place(unpriced, neverPriced)

	row := pendingRow(t, orderStat(t, priced, 2, 0))

	if row.GetCount() != 4 || row.GetItemCount() != 10 {
		t.Fatalf("count %d, units %d — want 4 orders and 10 units, every order's", row.GetCount(), row.GetItemCount())
	}

	if row.GetMpValue() != 25000 || row.GetGoodsCost() != 14000 || row.GetFees() != 350 {
		t.Fatalf("mp %d, goods_cost %d, fees %v — want only the measurable order's 25000, 14000 and 350",
			row.GetMpValue(), row.GetGoodsCost(), row.GetFees())
	}

	if row.GetMarginUnknown() != 3 {
		t.Fatalf("margin_unknown = %d, want 3 — no platform figure, no cost, never priced", row.GetMarginUnknown())
	}
}
