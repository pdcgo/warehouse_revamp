package selling_v1_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// a-borrowed-line-needs-its-map-at-create — BOTH doors into `orders` refuse a borrowed line the ordering team has not
// mapped for returns, naming it, before anything is taken or written. The cast is product_return_map_create_test.go's.

// borrowedOrderReq is team 2's order of one own product and the given borrowed ones.
func borrowedOrderReq(shopID uint64, borrowed ...uint64) *sellingv1.OrderCreateRequest {
	req := &sellingv1.OrderCreateRequest{
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                mapTeam, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		Items: []*sellingv1.OrderItem{
			{ProductId: ourProduct, Sku: "OWN", Name: "Our own", Quantity: 1},
		},
	}

	for _, id := range borrowed {
		req.Items = append(req.Items, &sellingv1.OrderItem{
			ProductId: id, Sku: "TYPED", Name: "Borrowed", Quantity: 1,
		})
	}

	return req
}

// The borrowed line with no map is refused, and the refusal NAMES it — by the catalogue's SKU, which is what the
// person has to go and map. Nothing is taken from the shelf and no order exists.
func TestOrderCreate_RefusesABorrowedLineWithNoReturnMap(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := selling_v1.NewService(db, picker, nil, returnMapCatalog(), &fakeCredit{}, nil, nil, nil)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(borrowedOrderReq(shop, borrowedA)))

	cerr := wantCode(t, err, connect.CodeFailedPrecondition)
	if !strings.Contains(cerr.Message(), "SKU501") || !strings.Contains(cerr.Message(), "for returns") {
		t.Fatalf("message %q should ask for SKU501 to be mapped for returns", cerr.Message())
	}

	if strings.Contains(cerr.Message(), "SKU601") {
		t.Fatalf("message %q names the team's own product, which needs no map", cerr.Message())
	}

	if len(picker.picked) != 0 {
		t.Fatalf("stock was taken for a refused order: %v", picker.picked)
	}

	if n := countOrders(t, db); n != 0 {
		t.Fatalf("%d orders written, want none", n)
	}
}

// EVERY unmapped borrowed product is named at once — one attempt says everything that is missing. A mapped one is not.
func TestOrderCreate_NamesEveryUnmappedBorrowedProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(borrowedOrderReq(shop, borrowedA, borrowedB)))

	cerr := wantCode(t, err, connect.CodeFailedPrecondition)
	if !strings.Contains(cerr.Message(), "SKU501") || !strings.Contains(cerr.Message(), "SKU502") {
		t.Fatalf("message %q should name both SKU501 and SKU502", cerr.Message())
	}

	mapForReturns(t, svc, mapTeam, borrowedA, ourProduct)

	_, err = svc.OrderCreate(context.Background(), connect.NewRequest(borrowedOrderReq(shop, borrowedA, borrowedB)))

	cerr = wantCode(t, err, connect.CodeFailedPrecondition)
	if strings.Contains(cerr.Message(), "SKU501") || !strings.Contains(cerr.Message(), "SKU502") {
		t.Fatalf("message %q should name only SKU502 once SKU501 is mapped", cerr.Message())
	}
}

// Mapped, the same order is placed.
func TestOrderCreate_AMappedBorrowedLineIsPlaced(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	mapForReturns(t, svc, mapTeam, borrowedA, ourProduct)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(borrowedOrderReq(shop, borrowedA)))
	if err != nil {
		t.Fatalf("a mapped borrowed line was refused: %v", err)
	}

	if n := countOrders(t, db); n != 1 {
		t.Fatalf("%d orders, want 1", n)
	}
}

// ⚠ ANOTHER TEAM'S MAP DOES NOT COUNT. Team 3 mapped the product; team 2 has not — team 2's order is still refused.
func TestOrderCreate_AnotherTeamsMapDoesNotCount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	mapForReturns(t, svc, 3, borrowedA, 701)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(borrowedOrderReq(shop, borrowedA)))

	wantCode(t, err, connect.CodeFailedPrecondition)
}

// AN OWN-ONLY ORDER NEEDS NO PAIR (an-own-line-never-touches-the-map): the team has mapped nothing, and its order of its
// own goods is placed.
func TestOrderCreate_AnOwnOnlyOrderNeedsNoMap(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(borrowedOrderReq(shop)))
	if err != nil {
		t.Fatalf("an order of the team's own goods was refused: %v", err)
	}

	if rows := returnMapRows(t, db, mapTeam); len(rows) != 0 {
		t.Fatalf("placing an own-only order wrote %d maps", len(rows))
	}
}

// ⚠ A FAILED OWNERS LOOKUP REFUSES THE CREATE (a-failed-owner-lookup-refuses-the-create) — the order cannot tell a
// borrowed line from its own, so it cannot know whether a map is missing. Nothing taken, nothing written.
func TestOrderCreate_AFailedOwnersLookupRefuses(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	catalog := &fakeCatalog{err: errors.New("product_service is down")}
	svc := selling_v1.NewService(db, picker, nil, catalog, &fakeCredit{}, nil, nil, nil)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(borrowedOrderReq(shop)))

	wantCode(t, err, connect.CodeUnavailable)

	if len(picker.picked) != 0 || countOrders(t, db) != 0 {
		t.Fatalf("a create with no owners lookup took %v and wrote %d orders", picker.picked, countOrders(t, db))
	}
}

// THE OTHER DOOR. Promote runs the same rule (placeOrder), so a draft holding a borrowed line with no map is refused
// naming it — and the draft survives to be finished once the product is mapped.
func TestOrderDraftPromote_RefusesABorrowedLineWithNoReturnMap(t *testing.T) {
	db := san_testdb.DB(t)
	// readyDraft maps its lines to 41 and 42; 41 is team 9's.
	catalog := &fakeCatalog{owners: map[uint64]uint64{41: 9, 42: mapTeam, ourProduct: mapTeam}}
	svc := newServiceWithCatalog(t, db, catalog)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	_, err := promote(t, svc, 7, mapTeam, draftID)

	cerr := wantCode(t, err, connect.CodeFailedPrecondition)
	if !strings.Contains(cerr.Message(), "SKU41") || strings.Contains(cerr.Message(), "SKU42") {
		t.Fatalf("message %q should name SKU41 only — 42 is the team's own", cerr.Message())
	}

	if n := countOrders(t, db); n != 0 {
		t.Fatalf("%d orders written, want none", n)
	}

	if _, err := draftDetail(t, svc, 7, mapTeam, draftID); err != nil {
		t.Fatalf("the draft is gone after a refused promote: %v", err)
	}

	mapForReturns(t, svc, mapTeam, 41, ourProduct)

	_, err = promote(t, svc, 7, mapTeam, draftID)
	if err != nil {
		t.Fatalf("promote once 41 is mapped: %v", err)
	}
}
