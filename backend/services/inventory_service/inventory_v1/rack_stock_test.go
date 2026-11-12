package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE SHELF'S LINES IN UNITS FOR A WAREHOUSE (a-warehouse-sees-ready-value-but-a-shelf-only-units): every line keeps its
// product, its count on this rack and whether a count holds it; the unit price, whether the cost is known and the value
// are UNSET — the rack page's Harga/pcs and Nilai are not a warehouse's. Root and the admin monitor keep all three.

func TestRackStock_AWarehouseReadsEachLineInUnitsOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, priced, unpriced := aRackWithGoods(t, svc, db)

	for _, role := range warehouseReaders {
		res, err := svc.RackStock(asRole(1, role), connect.NewRequest(&inventoryv1.RackStockRequest{
			TeamId: rackWarehouse, Filter: &inventoryv1.RackStockFilter{RackId: rackID}, Page: page1(),
		}))
		if err != nil {
			t.Fatalf("%s: RackStock: %v", role, err)
		}

		onHand := map[uint64]int64{}

		for _, line := range rackStockRows(res.Msg) {
			onHand[line.GetProductId()] = line.GetOnHand()

			if line.UnitCost != nil || line.CostKnown != nil || line.Value != nil {
				t.Fatalf("%s: line %d carries money %v / %v / %v, want all three unset",
					role, line.GetProductId(), line.UnitCost, line.CostKnown, line.Value)
			}
		}

		if onHand[priced] != 10 || onHand[unpriced] != 4 {
			t.Fatalf("%s: on hand = %v, want %d:10 and %d:4", role, onHand, priced, unpriced)
		}
	}
}

func TestRackStock_RootAndTheMonitorKeepThePriceAndTheValue(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, priced, unpriced := aRackWithGoods(t, svc, db)

	for who, ctx := range valueReaders() {
		res, err := svc.RackStock(ctx, connect.NewRequest(&inventoryv1.RackStockRequest{
			TeamId: rackWarehouse, Filter: &inventoryv1.RackStockFilter{RackId: rackID}, Page: page1(),
		}))
		if err != nil {
			t.Fatalf("%s: RackStock: %v", who, err)
		}

		byProduct := map[uint64]*inventoryv1.RackStockLine{}
		for _, line := range rackStockRows(res.Msg) {
			byProduct[line.GetProductId()] = line

			if line.UnitCost == nil || line.CostKnown == nil || line.Value == nil {
				t.Fatalf("%s: line %d = %+v, want the price, cost-known and value all set", who, line.GetProductId(), line)
			}
		}

		got := byProduct[priced]
		if got == nil || !got.GetCostKnown() || got.GetUnitCost() != 50000 || got.GetValue() != 500000 {
			t.Fatalf("%s: the restocked line = %+v, want 50000 × 10 = 500000", who, got)
		}

		other := byProduct[unpriced]
		if other == nil || !other.GetCostKnown() || other.GetUnitCost() != 1000 || other.GetValue() != 4000 {
			t.Fatalf("%s: the moved-in line = %+v, want 1000 × 4 = 4000", who, other)
		}
	}
}
