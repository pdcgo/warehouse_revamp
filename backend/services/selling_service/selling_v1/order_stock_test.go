package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func orderReq(shopID uint64) *sellingv1.OrderCreateRequest {
	return &sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 3, UnitPrice: 10000},
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
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(lst.Msg.GetOrders()) != 0 {
		t.Fatalf("a failed pick left %d orders behind", len(lst.Msg.GetOrders()))
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

	if got := detail.Msg.GetOrder().GetStatus(); got != sellingv1.OrderStatus_ORDER_STATUS_PLACED {
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
