package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #74 — what a product costs this warehouse is the AVERAGE VALUE OF THE UNITS HELD, read from its batches: only
// accepted deliveries have batches, so a pending price somebody hoped for counts for nothing.
func TestStockCost_TheAverageOfTheUnitsHeld(t *testing.T) {
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
					ProductId: productX, ProductCode: "SKU1", Name: "Widget",
					Count: lineQty, Total: float64(unitPrice * lineQty),
				},
			},
		}))
		if err != nil {
			t.Fatalf("create restock: %v", err)
		}

		if !fulfil {
			return
		}

		_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
			Lines: allArrived(t, db, created.Msg.GetRequest()),
		}))
		if err != nil {
			t.Fatalf("accept: %v", err)
		}
	}

	place(5000, true)  // an older delivery
	place(7000, true)  // the latest ACTUAL cost
	place(9999, false) // still pending — a price somebody hoped for, never paid

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, Filter: &inventoryv1.StockCostFilter{WarehouseId: warehouse, Ids: []uint64{productX}},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if len(stockCostLines(res.Msg)) != 1 {
		t.Fatalf("costs = %+v, want one line", stockCostLines(res.Msg))
	}

	// The two accepted deliveries, equal units at 5.000 and 7.000 — never the pending 9.999.
	if got := stockCostLines(res.Msg)[0].GetUnitCost(); got != 6000 {
		t.Fatalf("unit cost = %v, want 6000 — the average of the units held", got)
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
		TeamId: 2, Filter: &inventoryv1.StockCostFilter{WarehouseId: 5, Ids: []uint64{productX, 999999}},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if len(stockCostLines(res.Msg)) != 0 {
		t.Fatalf("costs = %+v, want none — nothing was ever restocked", stockCostLines(res.Msg))
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
			{ProductId: productX, ProductCode: "SKU1", Name: "Widget", Count: 5, Total: 4242},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: theirs, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, Filter: &inventoryv1.StockCostFilter{WarehouseId: mine, Ids: []uint64{productX}},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if len(stockCostLines(res.Msg)) != 0 {
		t.Fatalf("another warehouse's price leaked in: %+v", stockCostLines(res.Msg))
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
			{ProductId: productX, ProductCode: "SKU1", Name: "Widget", Count: 3, Total: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// The stored total is untouched by the awkward division — this is what the old contract could not do.
	if got := created.Msg.GetRequest().GetItems()[0].GetTotal(); got != 10000 {
		t.Fatalf("stored total = %v, want the typed 10000", got)
	}

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, Filter: &inventoryv1.StockCostFilter{WarehouseId: warehouse, Ids: []uint64{productX}},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if len(stockCostLines(res.Msg)) != 1 {
		t.Fatalf("costs = %+v, want one line", stockCostLines(res.Msg))
	}

	// The batch keeps 3.333,33… as is, and since the stock reads became doubles (every-ledger-moves-to-double-rounded-
	// when-frozen) so does the read: the unrounded unit cost, compared at san_money's 4 places — never pre-rounded.
	if got := stockCostLines(res.Msg)[0].GetUnitCost(); !san_money.Equal(got, 10000.0/3) {
		t.Fatalf("unit cost = %v, want 3333.3333… (10000 / 3, unrounded)", got)
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
		ShipmentCost: 15000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, ProductCode: "SKU1", Name: "Widget", Count: 10, Total: 100000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(t, db, created.Msg.GetRequest()),
		// The fee the courier took at the door — known only now, and only to the warehouse.
		WarehouseAdditionalCost: 5000, WarehouseAdditionalCostNote: courierNote,
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, Filter: &inventoryv1.StockCostFilter{WarehouseId: warehouse, Ids: []uint64{productX}},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	if got := stockCostLines(res.Msg)[0].GetUnitCost(); got != 12000 {
		t.Fatalf("HPP = %v, want 12000 (10.000 goods + 2.000 freight share)", got)
	}
}

// #155 — freight is spread over EVERY UNIT ORDERED (all-qty-is-every-unit-ordered), broken ones included: the crushed
// pair carries its share on its problem row, at the same landed price.
func TestStockCost_FreightIsSpreadOverEveryUnitOrdered(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		ShipmentCost: 20000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, ProductCode: "SKU1", Name: "Widget", Count: 10, Total: 100000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	// 10 turned up, 2 crushed: 8 sellable, onto the staging placement (there-is-no-unplaced-pile).
	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: req.GetItems()[0].GetId(), ReceivedCount: 10,
				BrokenCount: 2, BrokenNote: "crushed in transit",
				Placements: placedOn(stagingPlacement(t, db, warehouse), 8),
			},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, Filter: &inventoryv1.StockCostFilter{WarehouseId: warehouse, Ids: []uint64{productX}},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	// goods 100.000 / 10 = 10.000 ; freight 20.000 / 10 = 2.000 ; the batch's price 12.000.
	if got := stockCostLines(res.Msg)[0].GetUnitCost(); got != 12000 {
		t.Fatalf("HPP = %v, want 12000 — freight over all 10 ordered", got)
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
		ShipmentCost: 20000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, ProductCode: "SKU1", Name: "Widget", Count: 8, Total: 80000},
			{ProductId: productY, ProductCode: "SKU2", Name: "Gadget", Count: 2, Total: 40000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	res, err := svc.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: sellingTeam, Filter: &inventoryv1.StockCostFilter{WarehouseId: warehouse, Ids: []uint64{productX, productY}},
	}))
	if err != nil {
		t.Fatalf("StockCost: %v", err)
	}

	// 10 units on the request, so every unit carries 20.000 / 10 = 2.000 of freight.
	//   Widget: 80.000 / 8 = 10.000 + 2.000 = 12.000
	//   Gadget: 40.000 / 2 = 20.000 + 2.000 = 22.000
	want := map[uint64]float64{productX: 12000, productY: 22000}

	for _, c := range stockCostLines(res.Msg) {
		if got := c.GetUnitCost(); got != want[c.GetProductId()] {
			t.Fatalf("product %v HPP = %v, want %v", c.GetProductId(), got, want[c.GetProductId()])
		}
	}

	if len(stockCostLines(res.Msg)) != 2 {
		t.Fatalf("costs = %+v, want both products", stockCostLines(res.Msg))
	}
}

// THE WAREHOUSE PRODUCT PAGE READS IT (/inventories/products/:id): its one caller is a warehouse screen, so the policy
// admits the warehouse roles — it once admitted only the selling roles, from when it was an order's cost, and the page
// answered permission_denied to a warehouse Owner or Admin. RackDetail and RackStock already give every warehouse role
// the same average for a shelf.
func TestStockCost_PolicyAdmitsTheWarehouse(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.StockCostRequest"))
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("StockCostRequest has no policy")
	}

	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	} {
		if !slices.Contains(policy.GetRoles(), role) {
			t.Errorf("StockCost is closed to %s — the warehouse product page reads it", role)
		}
	}
}

// A WAREHOUSE READS ITS OWN BUILDING ONLY: scoped to its team, it gets its own shelf's average, and a filter naming
// another warehouse is refused rather than answered.
func TestStockCost_AWarehouseReadsItsOwnBuildingOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, mine, theirs uint64 = 2, 5, 6

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: mine,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, ProductCode: "SKU1", Name: "Widget", Count: 5, Total: 50000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: mine, RequestId: created.Msg.GetRequest().GetId(),
		Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	asAdmin := san_auth.WithCallerRole(ctx, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)

	res, err := svc.StockCost(asAdmin, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: mine, Filter: &inventoryv1.StockCostFilter{WarehouseId: mine, Ids: []uint64{productX}},
	}))
	if err != nil {
		t.Fatalf("its own building: %v", err)
	}

	lines := stockCostLines(res.Msg)
	if len(lines) != 1 || lines[0].GetUnitCost() != 10000 {
		t.Fatalf("its own building = %+v, want Widget at 10.000", lines)
	}

	_, err = svc.StockCost(asAdmin, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: mine, Filter: &inventoryv1.StockCostFilter{WarehouseId: theirs, Ids: []uint64{productX}},
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("another warehouse = %v, want PermissionDenied", err)
	}
}
