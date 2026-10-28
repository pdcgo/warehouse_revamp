package main

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// ONE PRODUCT ON TWO LINES, THROUGH THE REAL TAKE. The take refuses a product listed twice, so before placeOrder merged
// them an order carrying a bundle's product beside the same product picked by hand could never be placed. Here selling's
// placeOrder meets inventory's real OrderTransactionCreate through the composition root's adapter: the order is placed,
// stored as one line of 3, and the shelf gives up exactly 3.
func TestOrderCreate_OneProductOnTwoLinesThroughTheRealTake(t *testing.T) {
	const (
		team      uint64 = 9_000_030
		warehouse uint64 = 9_000_031
		product   uint64 = 9_000_032
	)

	db := san_testdb.DB(t)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil)
	svc := selling_v1.NewService(db, NewStockPicker(inventory), nil, nil, nil, nil, nil, nil)

	stockForPicker(t, inventory, team, warehouse, product, 5)
	shop := shopForOrders(t, db, team)

	res, err := svc.OrderCreate(context.Background(), connect.NewRequest(twoLinesOf(team, shop, warehouse, product)))
	if err != nil {
		t.Fatalf("an order naming one product on two lines: %v", err)
	}

	order := res.Msg.GetOrder()

	items := order.GetItems()
	if len(items) != 1 || items[0].GetProductId() != product || items[0].GetQuantity() != 3 {
		t.Fatalf("stored lines %v — want one line, product %d × 3", items, product)
	}

	if order.GetGoodsCost() != 30_000 || items[0].GetUnitCost() != 10_000 {
		t.Fatalf("goods_cost %d, unit cost %d — want the one draw of 3 × 10.000", order.GetGoodsCost(), items[0].GetUnitCost())
	}

	if left := ledgerUnits(t, db, warehouse, product); left != 2 {
		t.Fatalf("the shelf holds %d after the order, want 2 — exactly the 3 ordered taken", left)
	}
}

// A SHORT TAKE, THROUGH THE REAL TAKE: the warehouse holds 2 of the 3 the two lines ask for together, and the caller
// hears the take's own answer — FailedPrecondition and its OrderTransactionRefusal naming the line — never Internal.
func TestOrderCreate_AShortRealTakeKeepsItsCodeAndDetail(t *testing.T) {
	const (
		team      uint64 = 9_000_040
		warehouse uint64 = 9_000_041
		product   uint64 = 9_000_042
	)

	db := san_testdb.DB(t)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil)
	svc := selling_v1.NewService(db, NewStockPicker(inventory), nil, nil, nil, nil, nil, nil)

	stockForPicker(t, inventory, team, warehouse, product, 2)
	shop := shopForOrders(t, db, team)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(twoLinesOf(team, shop, warehouse, product)))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v (%v), want the take's FailedPrecondition", connect.CodeOf(err), err)
	}

	var refused *connect.Error
	if !errors.As(err, &refused) {
		t.Fatalf("err %v is not a Connect error", err)
	}

	var refusal *inventoryv1.OrderTransactionRefusal

	for _, detail := range refused.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}

		if r, ok := value.(*inventoryv1.OrderTransactionRefusal); ok {
			refusal = r
		}
	}

	if refusal.GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ENOUGH_STOCK ||
		len(refusal.GetLines()) != 1 || refusal.GetLines()[0].GetProductId() != product ||
		refusal.GetLines()[0].GetWanted() != 3 || refusal.GetLines()[0].GetAvailable() != 2 {
		t.Fatalf("refusal %v — want NOT_ENOUGH_STOCK naming product %d, wanted 3, available 2", refusal, product)
	}

	if left := ledgerUnits(t, db, warehouse, product); left != 2 {
		t.Fatalf("the shelf holds %d after a refused order, want its 2 untouched", left)
	}
}

// twoLinesOf is an order of one product on two lines — 2 picked by hand, 1 from a bundle — agreeing on everything else.
func twoLinesOf(team, shop, warehouse, product uint64) *sellingv1.OrderCreateRequest {
	line := func(quantity uint32) *sellingv1.OrderItem {
		return &sellingv1.OrderItem{ProductId: product, Sku: "SKU", Name: "Kaos", Quantity: quantity}
	}

	return &sellingv1.OrderCreateRequest{
		TeamId: team, ShopId: shop, WarehouseId: warehouse, CustomerName: "Budi",
		PlatformCreatedAtUnix: 1_790_000_000, PlatformTotal: 40_000,
		Items: []*sellingv1.OrderItem{line(2), line(1)},
	}
}

// shopForOrders seeds an active shop for `team` and returns its id.
func shopForOrders(t *testing.T, db *gorm.DB, team uint64) uint64 {
	t.Helper()

	var shop uint64

	err := db.Raw(`INSERT INTO shops (team_id, name, shop_code, marketplace) VALUES (?, 'Toko Melati', 'MEL', 'shopee')
		RETURNING id`, team).Scan(&shop).Error
	if err != nil {
		t.Fatalf("seed the shop: %v", err)
	}

	return shop
}
