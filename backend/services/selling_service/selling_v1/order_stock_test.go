package selling_v1_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func orderReq(shopID uint64) *sellingv1.OrderCreateRequest {
	return &sellingv1.OrderCreateRequest{
		ShipmentChannelId:     testShipmentChannel,
		IdempotencyKey:        newOrderKey(),
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, ProductCode: "SKU1", Name: "Widget", Quantity: 3},
		},
	}
}

// #149 — placing an order TAKES ITS STOCK, under the order's own idempotency key (backlog #10 slice 3,
// every-release-goes-by-the-key) so a later cancel or a compensation can name exactly this draw — and the order stores
// the transaction the take answered (the-placement-page-reads-racks-by-transaction-id).
func TestOrderCreate_TakesStock(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{txID: 4242}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	req := orderReq(shop)

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if len(picker.picked) != 1 {
		t.Fatalf("placing an order picked %d times, want 1", len(picker.picked))
	}

	if picker.picked[0] != req.GetIdempotencyKey() {
		t.Fatalf("picked under key %q, want the order's own key %q", picker.picked[0], req.GetIdempotencyKey())
	}

	if got := created.Msg.GetOrder().GetTransactionId(); got != 4242 {
		t.Fatalf("the order exposes transaction %d, want the take's 4242", got)
	}

	var stored selling_service_models.Order
	db.First(&stored, created.Msg.GetOrder().GetId())

	if stored.TransactionID == nil || *stored.TransactionID != 4242 || stored.IdempotencyKey != req.GetIdempotencyKey() {
		t.Fatalf("stored transaction %v, key %q — want 4242 under the request's key", stored.TransactionID, stored.IdempotencyKey)
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

// A CANCEL NO LONGER RELEASES IN ITS OWN FLOW (inventory-returns-stock-on-order-cancelled, backlog #10 slice 4): it asks
// whether a count holds the take — by the order's key — moves the status, and announces OrderCancelled carrying K and
// the warehouse, which inventory releases on. The picker's Return is never called.
func TestOrderCancel_ChecksTheCountThenPublishesTheKeyAndTheWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	key := created.Msg.GetOrder().GetIdempotencyKey()

	_, err = svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if len(picker.checked) != 1 || picker.checked[0] != key {
		t.Fatalf("count checked for %v, want once for the order's key %q", picker.checked, key)
	}

	if len(picker.returned) != 0 {
		t.Fatalf("the cancel released %v itself — the release is inventory's, on OrderCancelled", picker.returned)
	}

	var cancelled *eventsv1.OrderCancelled

	for _, e := range rec.events {
		if c := e.GetOrderCancelled(); c != nil {
			cancelled = c
		}
	}

	if cancelled == nil || cancelled.GetIdempotencyKey() != key || cancelled.GetWarehouseId() != testWarehouse ||
		cancelled.GetTeamId() != 2 {
		t.Fatalf("OrderCancelled = %+v, want key %q, warehouse %d, team 2", cancelled, key, testWarehouse)
	}
}

// A STOCK COUNT HOLDS A RACK THE TAKE CAME FROM (a-cancel-still-meets-the-count-first, a-lock-stops-sales-and-cancels-too):
// the cancel is refused BEFORE ANYTHING CHANGES — FailedPrecondition in the warehouse's words naming the count — the
// order stays pending with no cancel row on its timeline, nothing is announced and nothing released.
func TestOrderCancel_ACountRefusesItBeforeAnythingChanges(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()
	published := len(rec.events)

	picker.lock = &selling_v1.StockLock{
		SessionID: 12,
		Reason:    "product 7 on rack rak-a is being counted — count #12, started by user #3 at 2026-11-03 09:00 WIB",
	}

	_, err = svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: id,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "count #12") {
		t.Fatalf("cancel under a count: err = %v, want FailedPrecondition naming count #12", err)
	}

	var order selling_service_models.Order
	db.First(&order, id)

	if order.Status != "pending" {
		t.Fatalf("order status = %q, want still pending", order.Status)
	}

	var cancelRows int64
	db.Model(&selling_service_models.OrderTimelineLog{}).Where("order_id = ? AND status = ?", id, "cancel").Count(&cancelRows)

	if cancelRows != 0 {
		t.Fatalf("%d cancel rows on the timeline of a refused cancel", cancelRows)
	}

	if len(rec.events) != published || len(picker.returned) != 0 {
		t.Fatalf("a refused cancel published %d events and released %v", len(rec.events)-published, picker.returned)
	}
}

// THE CHECK COULD NOT BE MADE: the cancel is refused Unavailable — try again — and the order stays pending, rather than a
// status moved that nobody checked.
func TestOrderCancel_AFailedCountCheckLeavesTheOrderPending(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()
	picker.lockErr = errors.New("inventory unreachable")

	_, err = svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: id,
	}))
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}

	var order selling_service_models.Order
	db.First(&order, id)

	if order.Status != "pending" {
		t.Fatalf("order status = %q, want still pending", order.Status)
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
	picker := &fakePicker{costs: map[uint64]float64{100: 6000}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// 3 × sold at 10.000, cost 6.000 each.
	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got := created.Msg.GetOrder().GetGoodsCost(); got != 18000 {
		t.Fatalf("order goods_cost = %v, want 18000 (3 × 6000)", got)
	}

	// Read it back: the header total and the per-line cost are both stored, not just echoed.
	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetGoodsCost(); got != 18000 {
		t.Fatalf("stored goods_cost = %v, want 18000", got)
	}
	if got := detail.Msg.GetOrder().GetItems()[0].GetUnitCost(); got != 6000 {
		t.Fatalf("stored unit cost = %v, want 6000", got)
	}
}

// AN ORDER IS COSTED AT WHAT LEAVES THE SHELF (an-order-is-costed-at-what-leaves-the-shelf): 3 units drawn as 2 from the
// January batch at 10.000 and 1 from the March batch at 14.000 cost 34.000 — and the header's goods_cost, the fee's basis, the
// line's unit cost and its total all come from that ONE draw, never from the shelf's average. The goods_cost (an own product: no markup) is the draw
// itself, exact, so it adds up to what the goods were bought for — and the line's unit cost is the exact 11.333,33….
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
		t.Fatalf("stored goods_cost %v, fee %v — want the draw's 34000 and 10%% of it", order.GetGoodsCost(), order.GetWarehouseFee())
	}

	var items []selling_service_models.OrderItem

	err = db.Where("order_id = ?", order.GetId()).Find(&items).Error
	if err != nil {
		t.Fatalf("read the lines: %v", err)
	}

	if len(items) != 1 || !san_money.Equal(items[0].UnitCost, 34_000.0/3) || items[0].Total == nil || *items[0].Total != 34_000 {
		t.Fatalf("stored lines %+v — want the exact unit cost 11.333,33… (the draw ÷ 3) and total 34000", items)
	}
}

// #74 — a product with NO known cost freezes 0, and that means "unknown" rather than "free". The
// distinction is the whole reason the lookup omits unknown products instead of reporting zero for
// them: a margin computed over an unknown cost reads as pure profit.
func TestOrderCreate_UnknownCostFreezesZero(t *testing.T) {
	db := san_testdb.DB(t)
	// The warehouse has no restock history for product 100, so it is absent from the map.
	picker := &fakePicker{costs: map[uint64]float64{}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("an unknown cost must not block the order: %v", err)
	}

	if got := created.Msg.GetOrder().GetGoodsCost(); got != 0 {
		t.Fatalf("goods_cost = %v, want 0 for an unknown cost", got)
	}
}

// #74 — the cost comes from the WAREHOUSE, never from the request. A client supplying it would be
// writing its own margin, which is the one number nobody placing an order should get to choose.
func TestOrderCreate_ClientCannotSetItsOwnCost(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]float64{100: 6000}}
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
		t.Fatalf("unit cost = %v, want the warehouse's 6000 — a client set its own margin", got)
	}
	if got := created.Msg.GetOrder().GetGoodsCost(); got != 18000 {
		t.Fatalf("goods_cost = %v, want 18000", got)
	}
}
