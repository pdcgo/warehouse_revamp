package inventory_v1_test

import (
	"bytes"
	"log/slog"
	"strings"
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

// linkOwners is each product's link at this warehouse and the owner team it names (the-warehouse-link-names-its-owner-team).
func linkOwners(t *testing.T, db *gorm.DB, warehouseID uint64) map[uint64]uint64 {
	t.Helper()

	var rows []inventory_service_models.WarehouseProduct

	err := db.
		Where("warehouse_id = ?", warehouseID).
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("reading warehouse_products: %v", err)
	}

	owners := make(map[uint64]uint64, len(rows))
	for _, row := range rows {
		owners[row.ProductID] = row.OwnerTeamID
	}

	return owners
}

// capturedWarnings sends the default logger into a buffer for this test, and gives it back after — the package's tests
// never run in parallel, so no other test's lines land here.
func capturedWarnings(t *testing.T) *bytes.Buffer {
	t.Helper()

	var logged bytes.Buffer

	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logged, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(previous) })

	return &logged
}

// the-warehouse-link-names-its-owner-team — a restock links its products under the RESTOCK's team: its lines are that
// team's own products (a-restock-carries-only-the-teams-own-products).
func TestWarehouseProductLink_ARestockLinksUnderItsTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	createRestock(t, svc, warehouseA, 100, 200)

	owners := linkOwners(t, db, warehouseA)
	if len(owners) != 2 || owners[100] != 2 || owners[200] != 2 {
		t.Fatalf("links at warehouse A = %v (product → owner), want 100 and 200 both under team 2", owners)
	}
}

// the-warehouse-link-names-its-owner-team — an edit that adds a product links it under the restock's team too, and an
// edit that moves the restock to another warehouse links its products there under the same team.
func TestWarehouseProductLink_AnEditLinksUnderTheRestocksTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const otherWarehouse uint64 = 952

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouseA, FinanceAccountId: 7,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: 100, ProductCode: "SKU100", Name: "P100", Count: 1, Total: 100}},
	}))
	if err != nil {
		t.Fatalf("RestockRequestCreate: %v", err)
	}

	edit := func(warehouseID uint64, productIDs ...uint64) {
		t.Helper()

		items := make([]*inventoryv1.RestockRequestItem, 0, len(productIDs))
		for _, id := range productIDs {
			items = append(items, &inventoryv1.RestockRequestItem{ProductId: id, ProductCode: "SKU", Name: "Widget", Count: 1, Total: 100})
		}

		_, err := svc.RestockRequestUpdate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
			TeamId: 2, RequestId: created.Msg.GetRequest().GetId(), WarehouseId: warehouseID, FinanceAccountId: 7, Items: items,
		}))
		if err != nil {
			t.Fatalf("RestockRequestUpdate: %v", err)
		}
	}

	edit(warehouseA, 100, 200)

	owners := linkOwners(t, db, warehouseA)
	if len(owners) != 2 || owners[100] != 2 || owners[200] != 2 {
		t.Fatalf("links at warehouse A after the edit = %v, want 100 and the added 200 both under team 2", owners)
	}

	edit(otherWarehouse, 200, 300)

	moved := linkOwners(t, db, otherWarehouse)
	if len(moved) != 2 || moved[200] != 2 || moved[300] != 2 {
		t.Fatalf("links at the warehouse the edit moved to = %v, want 200 and 300 under team 2", moved)
	}
}

// A product has ONE owner (the-warehouse-link-names-its-owner-team): a writer naming another team than the link
// already stores never overwrites it — the stored owner is kept, the disagreement is reported naming both teams, and the
// restock that hit it still lands. A link stored under the writer's own team is met in silence.
func TestWarehouseProductLink_AnotherOwnerIsReportedAndNeverOverwritten(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	err := db.Exec(`INSERT INTO warehouse_products (warehouse_id, product_id, owner_team_id) VALUES (?, 100, 77), (?, 200, 2)`,
		warehouseA, warehouseA).Error
	if err != nil {
		t.Fatalf("seed the links: %v", err)
	}

	var before string

	db.Raw(`SELECT ctid::text FROM warehouse_products WHERE warehouse_id = ? AND product_id = 100`, warehouseA).Scan(&before)

	logged := capturedWarnings(t)

	createRestock(t, svc, warehouseA, 100, 200, 300)

	owners := linkOwners(t, db, warehouseA)
	if len(owners) != 3 || owners[100] != 77 || owners[200] != 2 || owners[300] != 2 {
		t.Fatalf("links = %v, want 100 kept under team 77, 200 under 2, the new 300 under 2", owners)
	}

	var after string

	db.Raw(`SELECT ctid::text FROM warehouse_products WHERE warehouse_id = ? AND product_id = 100`, warehouseA).Scan(&after)

	if before == "" || before != after {
		t.Fatalf("the stored link was rewritten (ctid %q → %q), want it untouched", before, after)
	}

	lines := strings.Split(strings.TrimSpace(logged.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("%d warnings, want exactly one (product 100):\n%s", len(lines), logged.String())
	}

	for _, want := range []string{"stored under another owner team", "product_id=100", "stored_owner_team_id=77", "writer_owner_team_id=2"} {
		if !strings.Contains(lines[0], want) {
			t.Fatalf("the warning %q does not say %q", lines[0], want)
		}
	}

	// Again under the same team: every link now agrees or is someone else's already reported — the agreeing ones say nothing.
	logged.Reset()

	createRestock(t, svc, warehouseA, 200, 300)

	if logged.Len() != 0 {
		t.Fatalf("re-linking products already under team 2 warned:\n%s", logged.String())
	}
}
