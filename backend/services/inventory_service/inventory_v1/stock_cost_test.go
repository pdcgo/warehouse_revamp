package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #74 — what a product cost this warehouse is the LATEST FULFILLED restock's price. Two things it must
// get right, and both are easy to get wrong: only fulfilled requests count, and "latest" is by the
// REQUEST, not by the line.
func TestStockCost_LatestFulfilledRestockPrice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	place := func(price int64, fulfil bool) {
		t.Helper()

		created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: productX, Sku: "SKU1", Name: "Widget", Quantity: 5, Price: price},
			},
		}))
		if err != nil {
			t.Fatalf("create restock: %v", err)
		}

		if !fulfil {
			return
		}

		_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
			TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
			Lines: allArrived(created.Msg.GetRequest()),
		}))
		if err != nil {
			t.Fatalf("fulfil: %v", err)
		}
	}

	place(5000, true)  // an older delivery
	place(7000, true)  // the latest ACTUAL cost
	place(9999, false) // still pending — a price somebody hoped for, never paid

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if len(res.Msg.GetCosts()) != 1 {
		t.Fatalf("costs = %+v, want one line", res.Msg.GetCosts())
	}

	// 7000, not 9999 (pending) and not 5000 (superseded).
	if got := res.Msg.GetCosts()[0].GetUnitCost(); got != 7000 {
		t.Fatalf("unit cost = %d, want 7000 — the latest FULFILLED price", got)
	}
}

// #74 — a product the warehouse has never restocked is ABSENT, not reported as 0. "We do not know what
// this cost" and "this cost nothing" are different facts, and a zero row would let an order book a
// margin as if the goods were free.
func TestStockCost_UnknownProductIsAbsentNotZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: 2, WarehouseId: 5, ProductIds: []uint64{productX, 999999},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if len(res.Msg.GetCosts()) != 0 {
		t.Fatalf("costs = %+v, want none — nothing was ever restocked", res.Msg.GetCosts())
	}
}

// #74 — one warehouse's costs are its own. Another warehouse buying the same product at a different
// price must not bleed into this one's margin.
func TestStockCost_ScopedToTheWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, mine, theirs uint64 = 2, 5, 6

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: theirs,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Quantity: 5, Price: 4242},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: theirs, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, WarehouseId: mine, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if len(res.Msg.GetCosts()) != 0 {
		t.Fatalf("another warehouse's price leaked in: %+v", res.Msg.GetCosts())
	}
}
