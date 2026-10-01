package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A product on TWO shelves is ONE row, not two — the list is per product, so a page of ten means ten
// products. Without the grouping the pager counts shelves and the same product appears twice.
func TestStockedProductList_OneRowPerProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	shelfA := insertRack(t, db, warehouseA, "A-01-1")
	shelfB := insertRack(t, db, warehouseA, "B-02-1")

	seedLevel(t, db, warehouseA, productX, &shelfA, 4)
	seedLevel(t, db, warehouseA, productX, &shelfB, 6)

	res, err := svc.StockedProductList(ctx, connect.NewRequest(&inventoryv1.StockedProductListRequest{
		TeamId: 2,
		Filter: &inventoryv1.StockedProductListFilter{WarehouseId: warehouseA},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("StockedProductList: %v", err)
	}

	if len(res.Msg.GetItems()) != 1 {
		t.Fatalf("got %d rows for one product on two shelves, want 1", len(res.Msg.GetItems()))
	}
	if res.Msg.GetItems()[0].GetAvailable() != 10 {
		t.Fatalf("available = %d, want 10 (4 + 6)", res.Msg.GetItems()[0].GetAvailable())
	}
	if res.Msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("total = %d, want 1 — the count must be over PRODUCTS, not stock rows",
			res.Msg.GetPageInfo().GetTotalItems())
	}
}

// Nothing on the shelf, nothing in the list.
//
// A picked-out product does not lose its rows — the shelves it used to sit on stay behind at 0 — so
// "has a stock_levels row here" and "can be sold from here" are different questions, and this is the
// case that tells them apart.
func TestStockedProductList_ExcludesProductsWithNothingLeft(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const productY uint64 = 402

	shelfA := insertRack(t, db, warehouseA, "A-01-1")
	shelfB := insertRack(t, db, warehouseA, "B-02-1")

	// X has stock; Y has been picked clean off both of its shelves.
	seedLevel(t, db, warehouseA, productX, &shelfA, 3)
	seedLevel(t, db, warehouseA, productY, &shelfA, 0)
	seedLevel(t, db, warehouseA, productY, &shelfB, 0)

	res, err := svc.StockedProductList(ctx, connect.NewRequest(&inventoryv1.StockedProductListRequest{
		TeamId: 2,
		Filter: &inventoryv1.StockedProductListFilter{WarehouseId: warehouseA},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("StockedProductList: %v", err)
	}

	for _, item := range res.Msg.GetItems() {
		if item.GetProductId() == productY {
			t.Fatalf("product %d nets to zero and must not be listed (available=%d)",
				productY, item.GetAvailable())
		}
	}

	if res.Msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("total = %d, want 1 — the COUNT must exclude it too, or the pager offers a page of nothing",
			res.Msg.GetPageInfo().GetTotalItems())
	}
}

// Stock in another warehouse is not in this warehouse's list. Obvious, and worth pinning: the whole
// point of the list is that it describes ONE building.
func TestStockedProductList_IsPerWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	seedLevel(t, db, warehouseB, productX, nil, 9)

	res, err := svc.StockedProductList(ctx, connect.NewRequest(&inventoryv1.StockedProductListRequest{
		TeamId: 2,
		Filter: &inventoryv1.StockedProductListFilter{WarehouseId: warehouseA},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("StockedProductList: %v", err)
	}

	if len(res.Msg.GetItems()) != 0 {
		t.Fatalf("warehouse A lists %d products for stock that is in warehouse B", len(res.Msg.GetItems()))
	}
}

// The id filter is how a SEARCH survives a list this service owns: the term was resolved against the
// catalogue elsewhere, and arrives here as ids. The paging still happens here, over the intersection,
// so the count describes what the caller will actually be able to page through.
func TestStockedProductList_NarrowsToTheGivenIds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const productY uint64 = 403

	seedLevel(t, db, warehouseA, productX, nil, 3)
	seedLevel(t, db, warehouseA, productY, nil, 7)

	res, err := svc.StockedProductList(ctx, connect.NewRequest(&inventoryv1.StockedProductListRequest{
		TeamId: 2,
		Filter: &inventoryv1.StockedProductListFilter{
			WarehouseId: warehouseA,
			ProductIds:  []uint64{productY},
		},
		Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("StockedProductList: %v", err)
	}

	if len(res.Msg.GetItems()) != 1 || res.Msg.GetItems()[0].GetProductId() != productY {
		t.Fatalf("got %v, want only product %d", res.Msg.GetIds(), productY)
	}
	if res.Msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("total = %d, want 1 — the count must narrow with the filter",
			res.Msg.GetPageInfo().GetTotalItems())
	}
}

// Paging is over PRODUCTS and the count comes from the grouped set — the bug this guards is a `Count`
// on a grouped query, which returns one row per group and reads back as "1 item" for a whole warehouse.
func TestStockedProductList_PagesOverProducts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	for i := range 5 {
		seedLevel(t, db, warehouseA, uint64(500+i), nil, int64(2+i))
	}

	first, err := svc.StockedProductList(ctx, connect.NewRequest(&inventoryv1.StockedProductListRequest{
		TeamId: 2,
		Filter: &inventoryv1.StockedProductListFilter{WarehouseId: warehouseA},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 2},
	}))
	if err != nil {
		t.Fatalf("StockedProductList: %v", err)
	}

	if first.Msg.GetPageInfo().GetTotalItems() != 5 {
		t.Fatalf("total = %d, want 5", first.Msg.GetPageInfo().GetTotalItems())
	}
	if first.Msg.GetPageInfo().GetTotalPage() != 3 {
		t.Fatalf("total pages = %d, want 3 (5 over pages of 2)", first.Msg.GetPageInfo().GetTotalPage())
	}
	if len(first.Msg.GetItems()) != 2 {
		t.Fatalf("page 1 has %d rows, want 2", len(first.Msg.GetItems()))
	}

	last, err := svc.StockedProductList(ctx, connect.NewRequest(&inventoryv1.StockedProductListRequest{
		TeamId: 2,
		Filter: &inventoryv1.StockedProductListFilter{WarehouseId: warehouseA},
		Page:   &commonv1.CommonPagination{Page: 3, Limit: 2},
	}))
	if err != nil {
		t.Fatalf("StockedProductList(page 3): %v", err)
	}
	if len(last.Msg.GetItems()) != 1 {
		t.Fatalf("page 3 has %d rows, want 1", len(last.Msg.GetItems()))
	}
}
