package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// acceptOne accepts a single-product, single-shelf delivery at a chosen cost (no freight), so a test
// can build cost layers with clean numbers.
func acceptOne(t *testing.T, svc *inventory_v1.Service, warehouse, rackID, product uint64, qty, total int64) {
	t.Helper()
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU", Name: "P", Quantity: qty, TotalPrice: total},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	item := created.Msg.GetRequest().GetItems()[0]

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId:           item.GetId(),
			ReceivedQuantity: qty,
			Placements:       []*inventoryv1.RestockPlacement{{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackID}, Quantity: qty}},
		}},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}
}

// Two deliveries of ONE product at different prices form two cost layers; stock value is their sum,
// not on-hand times a single price (#209).
func TestCostLayerList_GroupsByFrozenCost(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	rackID := rack.Msg.GetRack().GetId()

	acceptOne(t, svc, warehouse, rackID, product, 100, 4000000) // 40.000/pc
	acceptOne(t, svc, warehouse, rackID, product, 50, 1250000)  // 25.000/pc

	res, err := svc.CostLayerList(context.Background(), connect.NewRequest(&inventoryv1.CostLayerListRequest{
		TeamId: warehouse, ProductId: product, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("CostLayerList: %v", err)
	}
	layers := res.Msg.GetLayers()

	if len(layers) != 2 {
		t.Fatalf("%d layers, want 2", len(layers))
	}

	// Dearest first.
	if layers[0].GetUnitCost() != 40000 || layers[0].GetOnHand() != 100 || layers[0].GetAmount() != 4000000 {
		t.Fatalf("layer 0 = %d/%d/%d, want 40000/100/4000000", layers[0].GetUnitCost(), layers[0].GetOnHand(), layers[0].GetAmount())
	}
	if layers[1].GetUnitCost() != 25000 || layers[1].GetOnHand() != 50 || layers[1].GetAmount() != 1250000 {
		t.Fatalf("layer 1 = %d/%d/%d, want 25000/50/1250000", layers[1].GetUnitCost(), layers[1].GetOnHand(), layers[1].GetAmount())
	}

	// The header total values the whole shelf across layers.
	if res.Msg.GetTotalValue() != 5250000 {
		t.Fatalf("total_value = %d, want 5250000", res.Msg.GetTotalValue())
	}
}
