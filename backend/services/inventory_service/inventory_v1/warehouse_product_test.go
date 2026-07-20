package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func warehouseProducts(t *testing.T, svc *inventory_v1.Service, warehouseID uint64) []uint64 {
	t.Helper()

	res, err := svc.WarehouseProductList(ctxUser(1), connect.NewRequest(&inventoryv1.WarehouseProductListRequest{
		WarehouseId: warehouseID,
		Page:        &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("WarehouseProductList: %v", err)
	}

	return res.Msg.GetProductIds()
}

// createRestock sends a restock request naming these products, which is what makes them visible to the
// warehouse (#142).
func createRestock(t *testing.T, svc *inventory_v1.Service, warehouseID uint64, productIDs ...uint64) {
	t.Helper()

	items := make([]*inventoryv1.RestockRequestItem, 0, len(productIDs))
	for _, id := range productIDs {
		items = append(items, &inventoryv1.RestockRequestItem{
			ProductId: id, Sku: "SKU", Name: "Widget", Quantity: 1, Price: 1000,
		})
	}

	_, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouseID, Items: items,
	}))
	if err != nil {
		t.Fatalf("RestockRequestCreate: %v", err)
	}
}

// #142 — a warehouse sees the products it has been ASKED to handle, and only those.
//
// This is the whole point: a warehouse holds no products of its own, so a team-scoped product list
// shows it nothing. Asking it to stock something is what puts that product on its list.
func TestWarehouseProductList_ShowsOnlyWhatThisWarehouseWasAskedToHandle(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const otherWarehouse uint64 = 950

	createRestock(t, svc, warehouseA, 100, 200)
	createRestock(t, svc, otherWarehouse, 300)

	got := warehouseProducts(t, svc, warehouseA)

	if len(got) != 2 {
		t.Fatalf("warehouse A handles %d products, want 2: %v", len(got), got)
	}

	for _, id := range got {
		if id == 300 {
			t.Fatalf("another warehouse's product leaked into this list: %v", got)
		}
	}

	// And the other warehouse sees only its own.
	other := warehouseProducts(t, svc, otherWarehouse)
	if len(other) != 1 || other[0] != 300 {
		t.Fatalf("the other warehouse handles %v, want [300]", other)
	}
}

// #142 — asking for the same product AGAIN must not fail, and must not duplicate the arrangement.
//
// A second restock request for a product is the NORMAL case, not an error. If the link write were not
// idempotent, restocking a product you already stock would fail — which would make the common path the
// broken one.
func TestWarehouseProductList_RestockingTheSameProductAgainIsFine(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	createRestock(t, svc, warehouseA, 100)
	createRestock(t, svc, warehouseA, 100)
	createRestock(t, svc, warehouseA, 100, 200)

	got := warehouseProducts(t, svc, warehouseA)

	if len(got) != 2 {
		t.Fatalf("the warehouse handles %d products after repeat requests, want 2 (100 and 200): %v",
			len(got), got)
	}
}

// #142 — ONE request naming the same product on two lines.
//
// Honest note on what this pins: removing the handler's de-duplication does NOT fail this test, because
// ON CONFLICT DO NOTHING already tolerates duplicate rows inside one INSERT (it is DO UPDATE that
// raises "cannot affect row a second time" — checked, not assumed). This is a BEHAVIOURAL pin: a
// request may repeat a product, and the arrangement must not double however that is achieved.
func TestWarehouseProductList_ARequestListingAProductTwiceIsFine(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	createRestock(t, svc, warehouseA, 100, 100, 200)

	got := warehouseProducts(t, svc, warehouseA)

	if len(got) != 2 {
		t.Fatalf("a request listing product 100 twice produced %d arrangements, want 2: %v",
			len(got), got)
	}
}

// #142 — a warehouse nobody has asked for anything reads as empty, not as an error.
func TestWarehouseProductList_AnUnusedWarehouseIsEmpty(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	if got := warehouseProducts(t, svc, 951); len(got) != 0 {
		t.Fatalf("an unused warehouse handles %v, want nothing", got)
	}
}
