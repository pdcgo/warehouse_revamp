package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// warehouseProducts reads the arrangement rows straight from `warehouse_products`, newest first — the list RPC that
// once read them back (WarehouseProductList) is deleted (warehouse-product-list-is-deleted), and the rows stay: a
// restock and a transfer still write them, ProductHistory still reads them.
func warehouseProducts(t *testing.T, db *gorm.DB, warehouseID uint64) []uint64 {
	t.Helper()

	var ids []uint64

	err := db.
		Model(&inventory_service_models.WarehouseProduct{}).
		Where("warehouse_id = ?", warehouseID).
		Order("id DESC").
		Pluck("product_id", &ids).
		Error
	if err != nil {
		t.Fatalf("reading warehouse_products: %v", err)
	}

	return ids
}

// createRestock sends a restock request naming these products, which is what makes them visible to the
// warehouse (#142).
func createRestock(t *testing.T, svc *inventory_v1.Service, warehouseID uint64, productIDs ...uint64) {
	t.Helper()

	items := make([]*inventoryv1.RestockRequestItem, 0, len(productIDs))
	for _, id := range productIDs {
		items = append(items, &inventoryv1.RestockRequestItem{
			ProductId: id, ProductCode: "SKU", Name: "Widget", Count: 1, Total: 1000,
		})
	}

	_, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouseID, Items: items,
	}))
	if err != nil {
		t.Fatalf("RestockRequestCreate: %v", err)
	}
}

// #142 — a restock links its products to ITS warehouse, and only to it.
//
// This is the whole point: a warehouse holds no products of its own, so a team-scoped product list
// shows it nothing. Asking it to stock something is what puts that product on its list.
func TestWarehouseProductLink_ShowsOnlyWhatThisWarehouseWasAskedToHandle(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const otherWarehouse uint64 = 950

	createRestock(t, svc, warehouseA, 100, 200)
	createRestock(t, svc, otherWarehouse, 300)

	got := warehouseProducts(t, db, warehouseA)

	if len(got) != 2 {
		t.Fatalf("warehouse A handles %d products, want 2: %v", len(got), got)
	}

	for _, id := range got {
		if id == 300 {
			t.Fatalf("another warehouse's product leaked into this list: %v", got)
		}
	}

	// And the other warehouse sees only its own.
	other := warehouseProducts(t, db, otherWarehouse)
	if len(other) != 1 || other[0] != 300 {
		t.Fatalf("the other warehouse handles %v, want [300]", other)
	}
}

// #142 — asking for the same product AGAIN must not fail, and must not duplicate the arrangement.
//
// A second restock request for a product is the NORMAL case, not an error. If the link write were not
// idempotent, restocking a product you already stock would fail — which would make the common path the
// broken one.
func TestWarehouseProductLink_RestockingTheSameProductAgainIsFine(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	createRestock(t, svc, warehouseA, 100)
	createRestock(t, svc, warehouseA, 100)
	createRestock(t, svc, warehouseA, 100, 200)

	got := warehouseProducts(t, db, warehouseA)

	if len(got) != 2 {
		t.Fatalf("the warehouse handles %d products after repeat requests, want 2 (100 and 200): %v",
			len(got), got)
	}
}

// ONE restock naming the same product on two lines is REFUSED (a-product-appears-once-per-restock), and so links
// nothing: a restock that was never created makes no product visible to the warehouse.
func TestWarehouseProductLink_ARestockListingAProductTwiceIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouseA,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, ProductCode: "SKU100", Name: "P100", Count: 1, Total: 100},
			{ProductId: 100, ProductCode: "SKU100", Name: "P100", Count: 2, Total: 200},
		},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a restock listing product 100 twice: got %v, want InvalidArgument", err)
	}

	if got := warehouseProducts(t, db, warehouseA); len(got) != 0 {
		t.Fatalf("a refused restock linked %d products to the warehouse: %v", len(got), got)
	}
}

// #142 — a warehouse nobody has asked for anything has no arrangement row.
func TestWarehouseProductLink_AnUnusedWarehouseIsEmpty(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	createRestock(t, svc, warehouseA, 100)

	if got := warehouseProducts(t, db, 951); len(got) != 0 {
		t.Fatalf("an unused warehouse handles %v, want nothing", got)
	}
}
