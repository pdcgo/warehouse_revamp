package selling_v1_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// The order list's SEARCH, SHOP and DATE-WINDOW filters — the three a CS person reaches for when the
// list has stopped being scannable.
//
// All three are server-side, and every test here checks the PAGE COUNT as well as the rows. That is
// not belt-and-braces: the count drives the pager, and a filter applied to the rows but not to the
// count pages a two-order result as if it held two hundred — a bug that is invisible on page 1, which
// is the only page anybody looks at while developing.

// namedOrder places an order with a specific customer name and phone, so a search has something to
// find. Everything else matches the other fixtures.
func namedOrder(
	t *testing.T,
	svc *selling_v1.Service,
	shopID uint64,
	name, phone string,
) uint64 {
	t.Helper()

	resp, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: name, CustomerPhone: phone, Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("place order for %q: %v", name, err)
	}

	return resp.Msg.GetOrder().GetId()
}

// backdate moves an order's created_at, which is the only way to test a date window: every order a
// test places is stamped `now`, so without this the window is either "everything" or "nothing".
func backdate(t *testing.T, db *gorm.DB, orderID uint64, at time.Time) {
	t.Helper()

	err := db.Model(&selling_service_models.Order{}).
		Where("id = ?", orderID).
		UpdateColumn("created_at", at).
		Error
	if err != nil {
		t.Fatalf("backdate order %d: %v", orderID, err)
	}
}

// listFiltered is the call under test — the whole filter, so each test names only what it varies.
func listFiltered(
	t *testing.T,
	svc *selling_v1.Service,
	teamID uint64,
	filter *sellingv1.OrderListFilter,
) *sellingv1.OrderListResponse {
	t.Helper()

	res, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: teamID,
		Filter: filter,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("OrderList(team=%d, filter=%v): %v", teamID, filter, err)
	}

	return res.Msg
}

// wantOrders asserts the rows AND the paginated count agree with the ids expected, in any order.
func wantOrders(t *testing.T, got *sellingv1.OrderListResponse, want ...uint64) {
	t.Helper()

	rows := orderRows(got)

	found := map[uint64]bool{}
	for _, r := range rows {
		found[r.GetId()] = true
	}

	if len(rows) != len(want) {
		t.Fatalf("filtered list holds %d orders %v, want %d %v", len(rows), found, len(want), want)
	}

	for _, id := range want {
		if !found[id] {
			t.Fatalf("filtered list is missing order %d — it holds %v", id, found)
		}
	}

	if n := got.GetPageInfo().GetTotalItems(); n != uint64(len(want)) {
		t.Fatalf("filtered total = %d, want %d — the filter reached the rows but not the count, "+
			"so the pager is describing a different set than the table", n, len(want))
	}
}

// Search covers the customer's name, their phone, and the order id — the three things a person
// actually has in front of them when they are looking an order up.
func TestOrderList_SearchesNamePhoneAndOrderID(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	budi := namedOrder(t, svc, shop, "Budi Santoso", "081200001111")
	sari := namedOrder(t, svc, shop, "Sari Wijaya", "081999998888")

	// By name, and CASE-INSENSITIVE on a fragment — nobody types a customer's name with the same
	// capitalisation the order was saved with.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "budi"}), budi)
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "SANTOSO"}), budi)

	// By phone, on a fragment — the last four digits is what gets read out loud.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "9888"}), sari)

	// Whitespace around the term is trimmed; a term nothing matches returns nothing rather than
	// everything.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "  budi  "}), budi)
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "Nobody At All"}))

	// And "" is NOT a filter — a search box that has been cleared must return the list, not an empty
	// one.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: ""}), budi, sari)
}

// A numeric term searches the ORDER ID as well as the text columns — never INSTEAD of them, which is
// what this test's fixtures are shaped to show.
//
// The id match is EXACT (`id = n`) while the text columns are substring, and the asymmetry is the
// point: a phone number is also a run of digits, so "1" as an id means order 1 and nothing else, while
// "1" as a phone fragment legitimately matches every number containing a 1. These orders carry NO
// phone, so the only thing the term can hit is the id — which is the only way to assert the id leg on
// its own.
func TestOrderList_SearchMatchesTheOrderIDExactly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	wanted := namedOrder(t, svc, shop, "Budi Santoso", "")
	other := namedOrder(t, svc, shop, "Sari Wijaya", "")

	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		Search: strconv.FormatUint(wanted, 10),
	}), wanted)

	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		Search: strconv.FormatUint(other, 10),
	}), other)

	// An id nobody holds finds nothing — it must not fall back to matching everything.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "99999999"}))
}

// ⚠ THE PRECEDENCE TEST, and the reason the search clause is parenthesised by hand.
//
// The scope is `(team_id = ? OR warehouse_id = ?)` and the search is another OR. If the two were ever
// flattened — `team = x OR warehouse = x OR name ILIKE y` — a search would match orders belonging to
// teams the caller cannot see. That is a DATA-EXPOSURE bug rather than a wrong-rows bug, and it would
// arrive looking like a helpful feature: the searcher gets more results, not fewer.
func TestOrderList_SearchNeverLeaksAnotherTeamsOrders(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	mine := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	theirs := insertShop(t, db, 3, "Toko B", "TOKO-B", "shopee")

	// The SAME customer name on both teams' orders, so the search term matches both rows and only the
	// scope can tell them apart.
	ours := namedOrder(t, svc, mine, "Budi Santoso", "081200001111")

	_, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 3, ShopId: theirs, WarehouseId: 901,
		CustomerName: "Budi Santoso", CustomerPhone: "081200001111", Subtotal: 500, Total: 500,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 500},
		},
	}))
	if err != nil {
		t.Fatalf("create the other team's order: %v", err)
	}

	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "Budi"}), ours)
}

// A `%` or `_` typed into the search box is a LITERAL, not a wildcard. Without escaping, a lone "%"
// matches every order in the team — which reads as "the filter was ignored" rather than as a bad
// query, and is how somebody concludes the search is broken when it is in fact over-matching.
func TestOrderList_SearchTreatsWildcardsAsLiteralText(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	namedOrder(t, svc, shop, "Budi Santoso", "081200001111")
	namedOrder(t, svc, shop, "Sari Wijaya", "081999998888")

	// Neither customer's name contains these characters, so both searches find nothing.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "%"}))
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "_"}))

	// And a name that genuinely contains one is found by it.
	pct := namedOrder(t, svc, shop, "Diskon 50% Toko", "081777776666")
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: "50%"}), pct)
}

// The shop filter — "just the Shopee store's orders". A team runs a handful of shops and works them
// separately, so this is the segmentation that matches how the day is actually split up.
func TestOrderList_FiltersByShop(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopA := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	shopB := insertShop(t, db, 2, "Toko B", "TOKO-B", "tokopedia")

	onA := namedOrder(t, svc, shopA, "Budi", "0812")
	onB := namedOrder(t, svc, shopB, "Sari", "0813")

	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{ShopId: shopA}), onA)
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{ShopId: shopB}), onB)

	// 0 means no filter — it must not become a requirement.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{ShopId: 0}), onA, onB)
}

// The date window, inclusive on both ends, with 0 as an OPEN end on either side — so "everything since
// March" is expressible without inventing a far-future upper bound.
func TestOrderList_FiltersByDateWindow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	now := time.Now()

	old := namedOrder(t, svc, shop, "Lama", "0812")
	mid := namedOrder(t, svc, shop, "Tengah", "0813")
	recent := namedOrder(t, svc, shop, "Baru", "0814")

	backdate(t, db, old, now.AddDate(0, 0, -30))
	backdate(t, db, mid, now.AddDate(0, 0, -10))
	backdate(t, db, recent, now.AddDate(0, 0, -1))

	from := func(d int) int64 { return now.AddDate(0, 0, d).Unix() }

	// A closed window takes only what falls inside it.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		CreatedFromUnix: from(-15), CreatedToUnix: from(-5),
	}), mid)

	// An open upper end: everything from 15 days ago onwards.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		CreatedFromUnix: from(-15),
	}), mid, recent)

	// An open lower end: everything up to 5 days ago.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		CreatedToUnix: from(-5),
	}), old, mid)

	// {0,0} is every date — the cleared filter, and it must not read as an empty window.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{}), old, mid, recent)
}

// The three filters COMPOSE — they are ANDed, not last-one-wins. A CS person narrowing by shop and
// then typing a name expects both to hold.
func TestOrderList_FiltersCompose(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopA := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	shopB := insertShop(t, db, 2, "Toko B", "TOKO-B", "tokopedia")

	// The same customer bought from both shops. Only the shop tells the two orders apart.
	wanted := namedOrder(t, svc, shopA, "Budi Santoso", "0812")
	namedOrder(t, svc, shopB, "Budi Santoso", "0812")

	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		Search: "Budi", ShopId: shopA,
	}), wanted)

	// And composing with the STATUS tab, which is the one filter the stat does not share.
	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		Search: "Budi", ShopId: shopA, Status: sellingv1.OrderStatus_ORDER_STATUS_PLACED,
	}), wanted)

	wantOrders(t, listFiltered(t, svc, 2, &sellingv1.OrderListFilter{
		Search: "Budi", ShopId: shopA, Status: sellingv1.OrderStatus_ORDER_STATUS_CANCELLED,
	}))
}

// ⚠ THE HEADER MUST DESCRIBE THE TABLE.
//
// OrderStat's counts sit directly above the list, and the two RPCs are separate calls — so nothing but
// a shared query builder stops them describing different populations. A stat that ignored the shop
// filter would read "Placed 12" over four visible rows, with nothing on screen explaining the gap, and
// the person reading it would conclude the table was broken rather than the header.
//
// `status` is the deliberate exception: the tab filters the list and never the stat, because the stat
// groups BY status and filtering to one would zero every other tab's count.
func TestOrderStat_SharesTheListFilters(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopA := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	shopB := insertShop(t, db, 2, "Toko B", "TOKO-B", "tokopedia")

	namedOrder(t, svc, shopA, "Budi Santoso", "0812")
	namedOrder(t, svc, shopB, "Sari Wijaya", "0813")
	namedOrder(t, svc, shopB, "Sari Wijaya", "0813")

	placedCount := func(filter *sellingv1.OrderStatFilter) int64 {
		t.Helper()

		res, err := svc.OrderStat(ctx, connect.NewRequest(&sellingv1.OrderStatRequest{
			TeamId: 2, Filter: filter,
		}))
		if err != nil {
			t.Fatalf("OrderStat(%v): %v", filter, err)
		}

		for _, row := range res.Msg.GetByStatus() {
			if row.GetStatus() == sellingv1.OrderStatus_ORDER_STATUS_PLACED {
				return row.GetCount()
			}
		}

		return 0
	}

	if got := placedCount(&sellingv1.OrderStatFilter{}); got != 3 {
		t.Fatalf("unfiltered PLACED census = %d, want 3", got)
	}

	if got := placedCount(&sellingv1.OrderStatFilter{ShopId: shopA}); got != 1 {
		t.Fatalf("PLACED census for shop A = %d, want 1 — the stat is ignoring the shop filter the "+
			"list applies, so the header would sit above a table describing a different set", got)
	}

	if got := placedCount(&sellingv1.OrderStatFilter{Search: "Sari"}); got != 2 {
		t.Fatalf("PLACED census for search=Sari = %d, want 2 — the stat is ignoring the search", got)
	}

	// The date window too. Everything was placed just now, so a window that ends yesterday holds none.
	yesterday := time.Now().AddDate(0, 0, -1).Unix()
	if got := placedCount(&sellingv1.OrderStatFilter{CreatedToUnix: yesterday}); got != 0 {
		t.Fatalf("PLACED census up to yesterday = %d, want 0 — the stat is ignoring the date window", got)
	}
}
