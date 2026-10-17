package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

type rackLine struct {
	stock    int64
	products uint32
}

// rackStockTotals reads the STOCK slice of a RackList response, keyed by rack id.
func rackStockTotals(res *inventoryv1.RackListResponse) map[uint64]rackLine {
	out := map[uint64]rackLine{}
	for _, item := range res.GetItems() {
		if stock := item.GetStock(); stock != nil {
			for id, total := range stock.GetMapData() {
				out[id] = rackLine{stock: total.GetStockCount(), products: total.GetProductCount()}
			}
		}
	}

	return out
}

// The Racks list's stock and product columns (a-rack-shows-its-stock-count-for-now): each rack's products summed and
// counted, an empty rack 0 and 0, a level that fell to 0 neither summed nor counted, another warehouse's stock never in it.
func TestRackList_StockSliceSumsEachRack(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5

	full := insertRack(t, db, warehouse, "A-01-1")
	empty := insertRack(t, db, warehouse, "A-01-2")
	zeroed := insertRack(t, db, warehouse, "B-02-1")
	elsewhere := insertRack(t, db, 6, "A-01-1")

	seedLevel(t, db, warehouse, 71, &full, 12)
	seedLevel(t, db, warehouse, 73, &full, 5)
	seedLevel(t, db, warehouse, 74, &zeroed, 0)
	seedLevel(t, db, 6, 71, &elsewhere, 40)

	resp, err := svc.RackList(context.Background(), connect.NewRequest(&inventoryv1.RackListRequest{
		TeamId: warehouse,
		DataRequest: []inventoryv1.RackListDataType{
			inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_RACK,
			inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_STOCK,
		},
		Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackList: %v", err)
	}

	totals := rackStockTotals(resp.Msg)
	want := map[uint64]rackLine{
		full:   {stock: 17, products: 2},
		empty:  {stock: 0, products: 0},
		zeroed: {stock: 0, products: 0},
	}

	if len(totals) != len(want) {
		t.Fatalf("stock slice = %v, want one entry per rack on the page: %v", totals, want)
	}
	for id, n := range want {
		if got, ok := totals[id]; !ok || got != n {
			t.Fatalf("rack %d = %+v (present %v), want %+v", id, got, ok, n)
		}
	}
}

// Not asked for, not read: a picker that wants codes gets no STOCK slice.
func TestRackList_StockSliceOnlyWhenAsked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := insertRack(t, db, 5, "A-01-1")
	seedLevel(t, db, 5, 71, &rack, 3)

	resp, err := svc.RackList(context.Background(), connect.NewRequest(&inventoryv1.RackListRequest{
		TeamId: 5, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackList: %v", err)
	}

	if totals := rackStockTotals(resp.Msg); len(totals) != 0 {
		t.Fatalf("stock slice = %v, want none when not requested", totals)
	}
}
