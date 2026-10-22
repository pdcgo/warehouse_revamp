package main

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE ORDER'S TAKE THROUGH THE BRIDGE (the-order-take-bridges-its-key-per-order): selling's Pick reaches
// OrderTransactionCreate with the order's ref as its key, and its Return releases by the same key. This is the only
// place selling's picker and inventory's ledgers meet a database together.
func TestStockPicker_TakesAndReleasesByTheOrdersRef(t *testing.T) {
	const (
		team      uint64 = 9_000_020
		warehouse uint64 = 9_000_021
		product   uint64 = 9_000_022
	)

	db := san_testdb.DB(t)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil)
	picker := NewStockPicker(inventory)
	ctx := context.Background()

	stockForPicker(t, inventory, team, warehouse, product, 5)

	err := picker.Pick(ctx, team, warehouse, []selling_v1.PickLine{{ProductID: product, Quantity: 3}}, "order:42")
	if err != nil {
		t.Fatalf("Pick: %v", err)
	}

	if left := ledgerUnits(t, db, warehouse, product); left != 2 {
		t.Fatalf("after the pick the ledger holds %d, want 2", left)
	}

	// The same order cannot take twice — its key is spent.
	err = picker.Pick(ctx, team, warehouse, []selling_v1.PickLine{{ProductID: product, Quantity: 1}}, "order:42")
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("a second pick of order 42: err = %v, want AlreadyExists", err)
	}

	err = picker.Return(ctx, team, warehouse, "order:42")
	if err != nil {
		t.Fatalf("Return: %v", err)
	}

	if left := ledgerUnits(t, db, warehouse, product); left != 5 {
		t.Fatalf("after the return the ledger holds %d, want all 5 back", left)
	}

	// An order that never drew stock cancels cleanly.
	err = picker.Return(ctx, team, warehouse, "order:43")
	if err != nil {
		t.Fatalf("Return of an order that took nothing: %v", err)
	}

	// Too few is refused as it always was, so selling still refuses the order.
	err = picker.Pick(ctx, team, warehouse, []selling_v1.PickLine{{ProductID: product, Quantity: 9}}, "order:44")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a pick of 9 from 5: err = %v, want FailedPrecondition", err)
	}
}

// stockForPicker raises and accepts one restock of `count` units onto a new rack.
func stockForPicker(t *testing.T, inventory *inventory_v1.Service, team, warehouse, product uint64, count int64) {
	t.Helper()

	ctx := context.Background()

	rack, err := inventory.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: warehouse, Code: "rak-picker", Name: "Rak Picker",
	}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	created, err := inventory.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, Sku: "SKU", Name: "Kaos", Count: count, Total: float64(count * 10000)}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = inventory.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: count,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack.Msg.GetRack().GetId(), Quantity: count}},
		}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}
}

// ledgerUnits is what the batches hold of a product in a warehouse.
func ledgerUnits(t *testing.T, db *gorm.DB, warehouse, product uint64) int64 {
	t.Helper()

	var units int64

	err := db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE warehouse_id = ? AND product_id = ?`,
		warehouse, product).Scan(&units).Error
	if err != nil {
		t.Fatalf("read the batches: %v", err)
	}

	return units
}
