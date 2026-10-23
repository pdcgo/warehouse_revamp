package selling_v1_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// feeOrderReq is two lines of goods whose cost the picker knows: 2 × 4.000 + 1 × 6.000 = a goods cost of 14.000.
func feeOrderReq(shopID uint64) *sellingv1.OrderCreateRequest {
	return &sellingv1.OrderCreateRequest{
		PlatformCreatedAtUnix: testPlatformDate,
		TeamId:                2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", Subtotal: 30000, Total: 30000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 2, UnitPrice: 10000},
			{ProductId: 2, Sku: "SKU2", Name: "Gadget", Quantity: 1, UnitPrice: 10000},
		},
	}
}

func knownCosts() *fakePicker {
	return &fakePicker{costs: map[uint64]int64{1: 4000, 2: 6000}}
}

func countOrders(t *testing.T, db *gorm.DB) int64 {
	t.Helper()

	var n int64

	err := db.Model(&selling_service_models.Order{}).Count(&n).Error
	if err != nil {
		t.Fatalf("count orders: %v", err)
	}

	return n
}

// THE FEE IS PRICED ON THE GOODS COST AND FROZEN (the-fee-is-priced-on-goods-cost, the-flat-rate-is-dropped-last step 3):
// the warehouse is asked once, with the order's cogs as the basis, and what it answered is what the order keeps — on the
// response, the detail and the list row alike.
func TestOrderCreate_FreezesTheWarehouseFeeOnTheGoodsCost(t *testing.T) {
	db := san_testdb.DB(t)
	fees := &fakeFees{percent: 2.5}
	svc := newServiceWithFees(t, db, knownCosts(), fees)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(feeOrderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	order := created.Msg.GetOrder()

	if len(fees.asked) != 1 || fees.asked[0] != 14000 {
		t.Fatalf("the warehouse was asked to price %v — want once, on the goods cost 14000", fees.asked)
	}

	if order.GetCogs() != 14000 || !(order.WarehouseFee != nil) || order.GetWarehouseFee() != 350 {
		t.Fatalf("order cogs %d, fee %v (set %v) — want 14000 and 350, frozen", order.GetCogs(), order.GetWarehouseFee(),
			(order.WarehouseFee != nil))
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: order.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetWarehouseFee(); got != 350 {
		t.Fatalf("detail fee = %v, want the frozen 350", got)
	}

	rows := orderRows(listFiltered(t, svc, 2, &sellingv1.OrderListFilter{}))
	if len(rows) != 1 || rows[0].GetWarehouseFee() != 350 {
		t.Fatalf("list rows %+v — want one row carrying the frozen 350", rows)
	}
}

// A WAREHOUSE WITH NO RATE TAKES NO ORDERS (a-warehouse-with-no-rate-takes-no-orders): the refusal reaches the form
// naming the warehouse, no order is written, and no stock was taken — it is refused before the pick.
func TestOrderCreate_AWarehouseWithNoRateIsRefusedAndTakesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	picker := knownCosts()
	fees := &fakeFees{err: connect.NewError(connect.CodeFailedPrecondition, errors.New("Gudang A has not set its fee"))}
	svc := newServiceWithFees(t, db, picker, fees)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(feeOrderReq(shop)))

	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "Gudang A has not set its fee") {
		t.Fatalf("err = %v — want FailedPrecondition naming the warehouse", err)
	}

	if n := countOrders(t, db); n != 0 {
		t.Fatalf("%d orders written — a refused order must not exist", n)
	}

	if len(picker.picked) != 0 {
		t.Fatalf("stock was picked %v — the refusal must land before any stock moves", picker.picked)
	}
}

// A FEE NOBODY COULD COMPUTE PLACES NOTHING: a pricer that cannot be reached is Unavailable, never an order frozen at a
// guessed fee.
func TestOrderCreate_AnUnreachablePricerPlacesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	picker := knownCosts()
	svc := newServiceWithFees(t, db, picker, &fakeFees{err: errors.New("dial tcp: connection refused")})
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(feeOrderReq(shop)))

	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v — want Unavailable", err)
	}

	if n := countOrders(t, db); n != 0 || len(picker.picked) != 0 {
		t.Fatalf("%d orders written, picked %v — want nothing", n, picker.picked)
	}
}

// THE TRACKING NUMBER IS KEPT AS TYPED, and the search finds an order by it (a-label-scan-reads-the-ref-or-the-receipt):
// the number on a slip in somebody's hand is enough to find its order.
func TestOrderCreate_KeepsTheTrackingNumberAndTheSearchFindsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	req := feeOrderReq(shop)
	req.ReceiptCode = "JP0012345678"

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	other, err := svc.OrderCreate(context.Background(), connect.NewRequest(feeOrderReq(shop)))
	if err != nil {
		t.Fatalf("create the other: %v", err)
	}

	if got := created.Msg.GetOrder().GetReceiptCode(); got != "JP0012345678" {
		t.Fatalf("receipt_code = %q, want it verbatim", got)
	}

	// A service built without a pricer froze no fee: absent, never a 0.
	if other.Msg.GetOrder().WarehouseFee != nil {
		t.Fatalf("fee = %v — a service with no pricer must leave it absent", other.Msg.GetOrder().GetWarehouseFee())
	}

	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "12345678"}), created.Msg.GetOrder().GetId())
}
