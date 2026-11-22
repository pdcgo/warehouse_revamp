package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE SHELF'S LINES WITH THEIR PRICE AND VALUE FOR EVERY READER (placement.md given 11 — a warehouse reads each product
// on a rack with its units and value; the 🔄 2026-11-20 line of a-warehouse-sees-ready-value-but-a-shelf-only-units,
// backlog #109): every line keeps its product, its count on this rack and whether a count holds it, and carries its unit
// price, whether the cost is known and its value — SET, for the warehouse's three roles as for Root and the monitor.

func TestRackStock_EveryReaderIsGivenEachLinesPriceAndValue(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, priced, unpriced := aRackWithGoods(t, svc, db)

	for who, ctx := range shelfReaders() {
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
		if got == nil || got.GetOnHand() != 10 || !got.GetCostKnown() || got.GetUnitCost() != 50000 || got.GetValue() != 500000 {
			t.Fatalf("%s: the restocked line = %+v, want 10 at 50000 = 500000", who, got)
		}

		other := byProduct[unpriced]
		if other == nil || other.GetOnHand() != 4 || !other.GetCostKnown() || other.GetUnitCost() != 1000 || other.GetValue() != 4000 {
			t.Fatalf("%s: the moved-in line = %+v, want 4 at 1000 = 4000", who, other)
		}
	}
}
