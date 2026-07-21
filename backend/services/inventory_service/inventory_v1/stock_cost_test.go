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

	// The line stores its TOTAL (#140), so a test that wants a known per-unit cost multiplies up. Stated
	// as `unitPrice * lineQty` rather than as a bare number so the arithmetic the RPC has to undo is
	// visible in the test.
	const lineQty int64 = 5

	place := func(unitPrice int64, fulfil bool) {
		t.Helper()

		created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: sellingTeam, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{
					ProductId: productX, Sku: "SKU1", Name: "Widget",
					Quantity: lineQty, TotalPrice: unitPrice * lineQty,
				},
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
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Quantity: 5, TotalPrice: 4242},
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

// #140 — the line stores its TOTAL, and StockCost DERIVES the per-unit cost by dividing.
//
// The uneven case is the point: 10.000 over 3 pieces is 3.333 a piece with 1 rupiah left over. What
// matters is that the leftover is dropped at READ time and never written back — the stored 10.000
// stays exactly what the person typed off the invoice, which is the whole reason the total is the
// thing kept. Under the old per-unit contract that rupiah was lost at WRITE time, permanently.
func TestStockCost_DerivesThePerUnitCostFromTheLineTotal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			// Deliberately indivisible: 10.000 / 3 = 3.333,33…
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Quantity: 3, TotalPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// The stored total is untouched by the awkward division — this is what the old contract could not do.
	if got := created.Msg.GetRequest().GetItems()[0].GetTotalPrice(); got != 10000 {
		t.Fatalf("stored total = %d, want the typed 10000", got)
	}

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if len(res.Msg.GetCosts()) != 1 {
		t.Fatalf("costs = %+v, want one line", res.Msg.GetCosts())
	}

	// Rounded DOWN, and defined rather than incidental: an order books 3.333 for a unit that cost
	// 3.333,33. Rounding up would have the order claim to have paid more than the invoice.
	if got := res.Msg.GetCosts()[0].GetUnitCost(); got != 3333 {
		t.Fatalf("unit cost = %d, want 3333 (10000 / 3, rounded down)", got)
	}
}

// #155 — HPP: WHAT THE GOODS COST TO GET HERE, using the owner's own worked example.
//
//	product 10.000/pc × 10   = 100.000
//	shipping 15.000 + cod 5.000 = 20.000
//	additional = 20.000 / 10  = 2.000
//	hpp        = 10.000 + 2.000 = 12.000 / pc
//
// Freight is part of what a product cost, so an order's COGS carries it. Before this it did not, and
// every margin in the revenue report was quietly optimistic by exactly the freight.
func TestStockCost_HPPIncludesFreightAndTheCODFee(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		ShippingCost: 15000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 100000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(created.Msg.GetRequest()),
		// The fee the courier took at the door — known only now, and only to the warehouse.
		CodShippingFee: 5000,
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if got := res.Msg.GetCosts()[0].GetUnitCost(); got != 12000 {
		t.Fatalf("HPP = %d, want 12000 (10.000 goods + 2.000 freight share)", got)
	}
}

// #155/#154 — freight is spread over the SELLABLE units, not over everything that arrived.
//
// You paid to ship the broken ones too, and that cost has to land somewhere. Putting it on the good
// units means a damaged delivery correctly reads as more expensive per piece; dividing by 10 instead
// would leave the freight paid on the broken pair absorbed by nobody, and the margin quietly optimistic.
func TestStockCost_FreightIsSpreadOverSellableUnitsOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		ShippingCost: 20000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 100000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	// 10 turned up, 2 crushed: 8 sellable.
	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: req.GetItems()[0].GetId(), ReceivedQuantity: 8,
				Placements: []*inventoryv1.RestockPlacement{
					{Place: &inventoryv1.RestockPlacement_Unplaced{Unplaced: true}, Quantity: 8},
				},
				Damaged: []*inventoryv1.RestockDamagedUnits{
					{Quantity: 2, Reason: "crushed in transit", Value: 20000},
				},
			},
		},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ProductIds: []uint64{productX},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	// goods 100.000 / 8 = 12.500 ; freight 20.000 / 8 = 2.500 ; HPP = 15.000.
	// Dividing the freight by 10 instead would give 12.500 + 2.000 = 14.500.
	if got := res.Msg.GetCosts()[0].GetUnitCost(); got != 15000 {
		t.Fatalf("HPP = %d, want 15000 — freight over the 8 SELLABLE units, not over all 10", got)
	}
}

// #155 — one shipping cost, several lines: every unit carries the same freight whichever line it is
// on (owner: split by unit count, which is what "all stock count" means).
func TestStockCost_FreightIsSplitAcrossLinesByUnitCount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5
	const productY uint64 = 301

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		ShippingCost: 20000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Quantity: 8, TotalPrice: 80000},
			{ProductId: productY, Sku: "SKU2", Name: "Gadget", Quantity: 2, TotalPrice: 40000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ProductIds: []uint64{productX, productY},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	// 10 units on the request, so every unit carries 20.000 / 10 = 2.000 of freight.
	//   Widget: 80.000 / 8 = 10.000 + 2.000 = 12.000
	//   Gadget: 40.000 / 2 = 20.000 + 2.000 = 22.000
	want := map[uint64]int64{productX: 12000, productY: 22000}

	for _, c := range res.Msg.GetCosts() {
		if got := c.GetUnitCost(); got != want[c.GetProductId()] {
			t.Fatalf("product %d HPP = %d, want %d", c.GetProductId(), got, want[c.GetProductId()])
		}
	}

	if len(res.Msg.GetCosts()) != 2 {
		t.Fatalf("costs = %+v, want both products", res.Msg.GetCosts())
	}
}
