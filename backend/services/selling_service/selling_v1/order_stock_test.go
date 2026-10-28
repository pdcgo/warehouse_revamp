package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func orderReq(shopID uint64) *sellingv1.OrderCreateRequest {
	return &sellingv1.OrderCreateRequest{
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 3},
		},
	}
}

// #149 — placing an order TAKES ITS STOCK, under a reference derived from the order id so a later
// cancel can name exactly this draw.
func TestOrderCreate_TakesStock(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if len(picker.picked) != 1 {
		t.Fatalf("placing an order picked %d times, want 1", len(picker.picked))
	}

	// The ref names the order, so the ledger traces back to it and a cancel can undo exactly this.
	want := "order:" + itoa(created.Msg.GetOrder().GetId())
	if picker.picked[0] != want {
		t.Fatalf("picked under ref %q, want %q", picker.picked[0], want)
	}
}

// #149 — THE GUARANTEE: not enough stock means NO ORDER. This is the whole reason the owner chose
// "deduct at placement" over reserving, and the reason the pick happens before the commit.
func TestOrderCreate_NoStockMeansNoOrder(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{
		pickErr: connect.NewError(connect.CodeFailedPrecondition, errors.New("insufficient stock")),
	}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err == nil {
		t.Fatal("an order was created despite the stock draw failing")
	}

	// And no order row survived — read it back rather than trusting the error.
	lst, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(orderRows(lst.Msg)) != 0 {
		t.Fatalf("a failed pick left %d orders behind", len(orderRows(lst.Msg)))
	}
}

// #149 — a bad shop is rejected BEFORE any stock moves. Rejecting it afterwards would mean
// compensating a draw that never needed to happen.
func TestOrderCreate_BadShopTakesNoStock(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := newServiceWithPicker(t, db, picker)

	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	req := orderReq(shop)
	req.TeamId = 3 // another team's shop

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("cross-team create = %v, want NotFound", code)
	}

	if len(picker.picked) != 0 {
		t.Fatalf("a rejected order still took stock: %v", picker.picked)
	}
}

// #70 — cancelling an order PUTS ITS STOCK BACK, naming the same reference it was taken under.
func TestOrderCancel_ReturnsStock(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()

	_, err = svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if len(picker.returned) != 1 || picker.returned[0] != "order:"+itoa(id) {
		t.Fatalf("cancel returned %v, want one return of order:%d", picker.returned, id)
	}
}

// #70 — if the stock cannot be returned, the CANCEL FAILS and the order stays live. An order marked
// cancelled whose goods are still held out is a discrepancy nothing would ever reconcile.
func TestOrderCancel_FailedReturnLeavesTheOrderLive(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()

	// The warehouse refuses to give it back.
	picker.returnErr = connect.NewError(connect.CodeInternal, errors.New("warehouse unreachable"))

	_, err = svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: id,
	}))
	if err == nil {
		t.Fatal("the cancel succeeded despite the stock not coming back")
	}

	// The order is still PLACED — the status flip rolled back with the return.
	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetStatus(); got != sellingv1.OrderStatus_ORDER_STATUS_PENDING {
		t.Fatalf("order status = %v, want still PLACED — a cancel whose stock did not come back "+
			"must not stand", got)
	}
}

// #70 — an order placed before #149 drew no stock, so cancelling it has nothing to undo. The return
// reports NotFound for a ref that never picked, and that must read as success rather than blocking
// the cancel: refusing would be punishing history.
func TestOrderCancel_OrderThatNeverDrewStockStillCancels(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{
		returnErr: connect.NewError(connect.CodeNotFound, errors.New("no stock was picked under this reference")),
	}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("cancelling an order that drew no stock must work: %v", err)
	}
}

func itoa(n uint64) string {
	if n == 0 {
		return "0"
	}

	var b []byte

	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}

	return string(b)
}

// #74 — an order FREEZES what its goods cost, per line and totalled on the header, so margin is
// computable from the order alone: margin = platform_total − total_cost, total_cost = goods_cost + fee.
func TestOrderCreate_FreezesTheGoodsCost(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]int64{100: 6000}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// 3 × sold at 10.000, cost 6.000 each.
	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got := created.Msg.GetOrder().GetGoodsCost(); got != 18000 {
		t.Fatalf("order goods_cost = %d, want 18000 (3 × 6000)", got)
	}

	// Read it back: the header total and the per-line cost are both stored, not just echoed.
	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetGoodsCost(); got != 18000 {
		t.Fatalf("stored goods_cost = %d, want 18000", got)
	}
	if got := detail.Msg.GetOrder().GetItems()[0].GetUnitCost(); got != 6000 {
		t.Fatalf("stored unit cost = %d, want 6000", got)
	}
}

// AN ORDER IS COSTED AT WHAT LEAVES THE SHELF (an-order-is-costed-at-what-leaves-the-shelf): 3 units drawn as 2 from the
// January batch at 10.000 and 1 from the March batch at 14.000 cost 34.000 — and the header's goods_cost, the fee's basis, the
// line's unit cost and its total all come from that ONE draw, never from the shelf's average. The goods_cost (an own product: no markup) is the draw
// itself, rounded once, so it adds up to what the goods were bought for — not 3 × the rounded 11.333.
func TestOrderCreate_FreezesEveryFigureFromTheTakesDraw(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{draw: selling_v1.PickDraw{
		100: {Cost: 34_000, UnitCost: 34_000.0 / 3, Total: 34_000},
	}}
	fees := &fakeFees{percent: 10}
	svc := newServiceWithFees(t, db, picker, fees)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if len(fees.asked) != 1 || fees.asked[0] != 34_000 {
		t.Fatalf("the fee was priced on %v — want once, on the draw's 34000", fees.asked)
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	order := detail.Msg.GetOrder()
	if order.GetGoodsCost() != 34_000 || order.GetWarehouseFee() != 3_400 {
		t.Fatalf("stored goods_cost %d, fee %v — want the draw's 34000 and 10%% of it", order.GetGoodsCost(), order.GetWarehouseFee())
	}

	var items []selling_service_models.OrderItem

	err = db.Where("order_id = ?", order.GetId()).Find(&items).Error
	if err != nil {
		t.Fatalf("read the lines: %v", err)
	}

	if len(items) != 1 || items[0].UnitCost != 11_333 || items[0].Total == nil || *items[0].Total != 34_000 {
		t.Fatalf("stored lines %+v — want unit cost 11333 (the draw ÷ 3) and total 34000", items)
	}
}

// #74 — a product with NO known cost freezes 0, and that means "unknown" rather than "free". The
// distinction is the whole reason the lookup omits unknown products instead of reporting zero for
// them: a margin computed over an unknown cost reads as pure profit.
func TestOrderCreate_UnknownCostFreezesZero(t *testing.T) {
	db := san_testdb.DB(t)
	// The warehouse has no restock history for product 100, so it is absent from the map.
	picker := &fakePicker{costs: map[uint64]int64{}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("an unknown cost must not block the order: %v", err)
	}

	if got := created.Msg.GetOrder().GetGoodsCost(); got != 0 {
		t.Fatalf("goods_cost = %d, want 0 for an unknown cost", got)
	}
}

// #74 — the cost comes from the WAREHOUSE, never from the request. A client supplying it would be
// writing its own margin, which is the one number nobody placing an order should get to choose.
func TestOrderCreate_ClientCannotSetItsOwnCost(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]int64{100: 6000}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	req := orderReq(shop)
	req.Items[0].UnitCost = 1 // "these cost us almost nothing"

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// The warehouse's figure won, not the caller's.
	if got := created.Msg.GetOrder().GetItems()[0].GetUnitCost(); got != 6000 {
		t.Fatalf("unit cost = %d, want the warehouse's 6000 — a client set its own margin", got)
	}
	if got := created.Msg.GetOrder().GetGoodsCost(); got != 18000 {
		t.Fatalf("goods_cost = %d, want 18000", got)
	}
}
