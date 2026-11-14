package product_v1_test

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// List is team-scoped: it returns only the caller's team's products, never another team's.
func TestProductList_ScopedToTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha")
	insertProduct(t, db, 2, "A-2", "Beta")
	insertProduct(t, db, 3, "B-1", "Gamma") // another team

	resp, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList: %v", err)
	}

	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total items = %d, want 2 (team 3's product must not leak)", resp.Msg.GetPageInfo().GetTotalItems())
	}
	for _, p := range listRows(resp.Msg.GetItems()) {
		if p.GetTeamId() != 2 {
			t.Errorf("got a product from team %d in team 2's list", p.GetTeamId())
		}
	}
}

func TestProductList_QueryAndPaging(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "BOLT-1", "Steel bolt")
	insertProduct(t, db, 2, "NUT-1", "Steel nut")
	insertProduct(t, db, 2, "GLUE-1", "Adhesive")

	// q matches name OR product code.
	resp, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2,
		Filter: &productv1.ProductListFilter{Q: "steel"},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList(q): %v", err)
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("q=steel total = %d, want 2", resp.Msg.GetPageInfo().GetTotalItems())
	}

	// limit 2 over 3 rows → 2 pages.
	paged, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 2},
	}))
	if err != nil {
		t.Fatalf("ProductList(paged): %v", err)
	}
	if len(paged.Msg.GetIds()) != 2 || paged.Msg.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("paging: got %d rows, %d pages; want 2 and 2",
			len(paged.Msg.GetIds()), paged.Msg.GetPageInfo().GetTotalPage())
	}
}

// ── The lock and the stock's age (lock-and-stock-age-filter-ahead-of-the-contract) ────────────────────────────────────
//
// The three ways are product_service's own columns; "locked now" and the age ask inventory through the StockNarrower
// seam, faked here — the real one over real batches is cmd/app_development/product_stock_narrower_test.go.

// fakeStock answers the seam from fixed sets and records what it was asked.
type fakeStock struct {
	closed     []uint64
	aged       []uint64
	err        error
	candidates []product_v1.MinimumCandidate
	agedAsks   [][3]uint64 // team, warehouse, days
	// Discover's shelves: what ShelvedProducts and ProductsReadyAbove answer, and what each was asked.
	shelved   []product_v1.ShelvedProduct
	above     []product_v1.ShelvedProduct
	shelfAsks []product_v1.ShelfAsk
	aboveAsks []int64
}

func (f *fakeStock) ShelvedProducts(_ context.Context, ask product_v1.ShelfAsk) ([]product_v1.ShelvedProduct, error) {
	f.shelfAsks = append(f.shelfAsks, ask)

	return f.shelved, f.err
}

func (f *fakeStock) ProductsReadyAbove(_ context.Context, ceiling int64) ([]product_v1.ShelvedProduct, error) {
	f.aboveAsks = append(f.aboveAsks, ceiling)

	return f.above, f.err
}

func (f *fakeStock) ClosedByMinimum(_ context.Context, candidates []product_v1.MinimumCandidate) ([]uint64, error) {
	f.candidates = append(f.candidates, candidates...)

	return f.closed, f.err
}

func (f *fakeStock) AgedAtLeast(_ context.Context, teamID, warehouseID uint64, days uint32) ([]uint64, error) {
	f.agedAsks = append(f.agedAsks, [3]uint64{teamID, warehouseID, uint64(days)})

	return f.aged, f.err
}

// lockFixture is team 2's catalogue in every way of the lock, plus team 3's minimum product.
type lockFixture struct {
	open, minA, minB, always, archivedMin, theirs uint64
}

func seedLocks(t *testing.T, db *gorm.DB) lockFixture {
	t.Helper()

	f := lockFixture{
		open:        insertProduct(t, db, 2, "T2-KAOS-1", "Kaos Terbuka"),
		minA:        insertProduct(t, db, 2, "T2-KAOS-2", "Kaos Minimum"),
		minB:        insertProduct(t, db, 2, "T2-CEL-1", "Celana Minimum"),
		always:      insertProduct(t, db, 2, "T2-KAOS-3", "Kaos Dikunci"),
		archivedMin: insertProduct(t, db, 2, "T2-KAOS-4", "Kaos Arsip"),
		theirs:      insertProduct(t, db, 3, "T3-KAOS-1", "Kaos Tim Lain"),
	}

	setProduct(t, db, f.minA, "reserved_stock", 20)
	setProduct(t, db, f.minB, "reserved_stock", 5)
	// Always wins: a locked product keeps its minimum and is still "always".
	setProduct(t, db, f.always, "cross_locked", true)
	setProduct(t, db, f.always, "reserved_stock", 3)
	setProduct(t, db, f.archivedMin, "reserved_stock", 7)
	setProduct(t, db, f.archivedMin, "archived", true)
	setProduct(t, db, f.theirs, "reserved_stock", 9)

	return f
}

// listIDs runs ProductList for team 2 and returns its page's ids and its total.
func listIDs(t *testing.T, svc *product_v1.Service, req *productv1.ProductListRequest) ([]uint64, uint64) {
	t.Helper()

	if req.TeamId == 0 {
		req.TeamId = 2
	}

	if req.Page == nil {
		req.Page = &commonv1.CommonPagination{Page: 1, Limit: 50}
	}

	resp, err := svc.ProductList(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ProductList(%v): %v", req.GetFilter(), err)
	}

	return resp.Msg.GetIds(), resp.Msg.GetPageInfo().GetTotalItems()
}

func sorted(ids ...uint64) []uint64 {
	out := slices.Clone(ids)
	slices.Sort(out)

	return out
}

// The three ways read the two fields as one setting (one-lock-three-ways) — product_service's own columns, so no stock
// reader is asked (a nil one is fine).
func TestProductList_LockWaysReadTheTwoFields(t *testing.T) {
	db := san_testdb.DB(t)
	svc := product_v1.NewService(db, history, teamCodes, nil, nil)
	f := seedLocks(t, db)

	cases := []struct {
		name string
		lock productv1.ProductLockFilter
		want []uint64
	}{
		{"no lock filter", productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_UNSPECIFIED, sorted(f.open, f.minA, f.minB, f.always)},
		{"Terbuka", productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_OPEN, []uint64{f.open}},
		{"Stok minimum", productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_MINIMUM, sorted(f.minA, f.minB)},
		{"Selalu dikunci — with a minimum kept", productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_ALWAYS, []uint64{f.always}},
	}

	for _, c := range cases {
		ids, total := listIDs(t, svc, &productv1.ProductListRequest{Filter: &productv1.ProductListFilter{Lock: c.lock}})
		if !reflect.DeepEqual(sorted(ids...), c.want) || total != uint64(len(c.want)) {
			t.Fatalf("%s: ids %v (total %d), want %v", c.name, ids, total, c.want)
		}
	}

	// With the search: the minimum products named Kaos only.
	ids, _ := listIDs(t, svc, &productv1.ProductListRequest{Filter: &productv1.ProductListFilter{
		Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_MINIMUM, Q: "kaos",
	}})
	if !reflect.DeepEqual(ids, []uint64{f.minA}) {
		t.Fatalf("minimum + q=kaos: %v, want only Kaos Minimum", ids)
	}

	// On the archive: the archived minimum product.
	ids, _ = listIDs(t, svc, &productv1.ProductListRequest{Filter: &productv1.ProductListFilter{
		Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_MINIMUM, Status: productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED,
	}})
	if !reflect.DeepEqual(ids, []uint64{f.archivedMin}) {
		t.Fatalf("minimum on the archive: %v, want only Kaos Arsip", ids)
	}
}

// Terkunci sekarang hands inventory the scope's MINIMUM products only — this team's, this half, this search — each with
// its minimum, and lists the ids inventory says are under it. The way is checked again: an id that is not a minimum
// product (the always-locked one, another team's) never lists, whatever comes back.
func TestProductList_LockedNowAsksForTheScopesMinimums(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedLocks(t, db)
	stock := &fakeStock{closed: []uint64{f.minA, f.always, f.theirs}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	ids, total := listIDs(t, svc, &productv1.ProductListRequest{
		Filter:           &productv1.ProductListFilter{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW},
		StockWarehouseId: 77, // the lens: the lock never reads it
	})
	if !reflect.DeepEqual(ids, []uint64{f.minA}) || total != 1 {
		t.Fatalf("locked now: %v (total %d), want only Kaos Minimum", ids, total)
	}

	want := []product_v1.MinimumCandidate{
		{TeamID: 2, ProductID: f.minA, Minimum: 20},
		{TeamID: 2, ProductID: f.minB, Minimum: 5},
	}

	got := slices.Clone(stock.candidates)
	slices.SortFunc(got, func(a, b product_v1.MinimumCandidate) int { return int(a.ProductID) - int(b.ProductID) })

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("candidates = %+v, want team 2's two live minimum products with their minimums", got)
	}

	if len(stock.agedAsks) != 0 {
		t.Fatalf("the age was asked %v with no age filter", stock.agedAsks)
	}

	// The search narrows the candidates too: Celana only.
	stock.candidates = nil
	stock.closed = []uint64{f.minB}

	ids, _ = listIDs(t, svc, &productv1.ProductListRequest{Filter: &productv1.ProductListFilter{
		Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW, Q: "celana",
	}})
	if !reflect.DeepEqual(ids, []uint64{f.minB}) || len(stock.candidates) != 1 || stock.candidates[0].ProductID != f.minB {
		t.Fatalf("locked now + q=celana: %v, candidates %+v — want Celana Minimum alone", ids, stock.candidates)
	}
}

// Nothing to ask, or nothing comes back: an EMPTY list, total 0 — never the unnarrowed one.
func TestProductList_LockedNowWithNothingInForceIsEmpty(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedLocks(t, db)
	stock := &fakeStock{}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	ids, total := listIDs(t, svc, &productv1.ProductListRequest{Filter: &productv1.ProductListFilter{
		Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW,
	}})
	if len(ids) != 0 || total != 0 {
		t.Fatalf("nothing in force: %v (total %d), want empty", ids, total)
	}

	// A search no minimum product matches: inventory is not even asked.
	stock.candidates = nil
	stock.closed = []uint64{f.minA}

	ids, total = listIDs(t, svc, &productv1.ProductListRequest{Filter: &productv1.ProductListFilter{
		Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW, Q: "terbuka",
	}})
	if len(ids) != 0 || total != 0 || len(stock.candidates) != 0 {
		t.Fatalf("no candidate: %v (total %d), asked %+v — want empty, nothing asked", ids, total, stock.candidates)
	}
}

// The age asks inventory for the TEAM's aged products in the lens's warehouse; an id of another team's product that
// came back never lists — the page's own WHERE keeps the team.
func TestProductList_StockAgeAsksInTheLens(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedLocks(t, db)
	stock := &fakeStock{aged: []uint64{f.open, f.minB, f.theirs}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	ids, total := listIDs(t, svc, &productv1.ProductListRequest{
		Filter:           &productv1.ProductListFilter{StockAgeMinDays: 60},
		StockWarehouseId: 14,
	})
	if !reflect.DeepEqual(sorted(ids...), sorted(f.open, f.minB)) || total != 2 {
		t.Fatalf("age 60: %v (total %d), want Kaos Terbuka and Celana Minimum", ids, total)
	}

	if !reflect.DeepEqual(stock.agedAsks, [][3]uint64{{2, 14, 60}}) {
		t.Fatalf("asked %v, want team 2, warehouse 14, 60 days", stock.agedAsks)
	}

	// With the lock and the search: both narrowings at once, one count.
	ids, total = listIDs(t, svc, &productv1.ProductListRequest{Filter: &productv1.ProductListFilter{
		StockAgeMinDays: 60, Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_OPEN, Q: "kaos",
	}})
	if !reflect.DeepEqual(ids, []uint64{f.open}) || total != 1 {
		t.Fatalf("age 60 + Terbuka + q=kaos: %v (total %d), want Kaos Terbuka", ids, total)
	}

	// Nothing that old: empty.
	stock.aged = nil

	ids, total = listIDs(t, svc, &productv1.ProductListRequest{Filter: &productv1.ProductListFilter{StockAgeMinDays: 90}})
	if len(ids) != 0 || total != 0 {
		t.Fatalf("nothing 90 days old: %v (total %d), want empty", ids, total)
	}
}

// The narrowed list still counts, sorts and pages as one list: the total is the narrowed one and page 2 holds the rest.
func TestProductList_NarrowedListPagesAndSorts(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedLocks(t, db)
	extra := insertProduct(t, db, 2, "T2-ANG-1", "Anggur Minimum")
	setProduct(t, db, extra, "reserved_stock", 2)

	stock := &fakeStock{closed: []uint64{f.minA, f.minB, extra}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	byName := &productv1.ProductListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
		S:        &productv1.ProductListFilterSort_Product{Product: productv1.ProductRowSort_PRODUCT_ROW_SORT_NAME},
	}

	page := func(n uint32) ([]uint64, *commonv1.PageInfo) {
		resp, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
			TeamId: 2,
			Filter: &productv1.ProductListFilter{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW},
			Sort:   byName,
			Page:   &commonv1.CommonPagination{Page: n, Limit: 2},
		}))
		if err != nil {
			t.Fatalf("page %d: %v", n, err)
		}

		return resp.Msg.GetIds(), resp.Msg.GetPageInfo()
	}

	first, info := page(1)
	second, _ := page(2)

	if info.GetTotalItems() != 3 || info.GetTotalPage() != 2 {
		t.Fatalf("total %d over %d pages, want 3 over 2", info.GetTotalItems(), info.GetTotalPage())
	}

	if !reflect.DeepEqual(append(first, second...), []uint64{extra, f.minB, f.minA}) {
		t.Fatalf("by name across pages = %v, want Anggur, Celana, Kaos", append(first, second...))
	}

	// A page past the last match has no row to carry the count: it still says 3.
	past, info := page(5)
	if len(past) != 0 || info.GetTotalItems() != 3 || info.GetTotalPage() != 2 {
		t.Fatalf("page 5: %v, total %d over %d pages — want none, 3 over 2", past, info.GetTotalItems(), info.GetTotalPage())
	}
}

// Without a stock reader the two stock filters are refused (Unavailable) — never answered unnarrowed — and a reader's
// failure is an Internal error.
func TestProductList_StockFiltersNeedTheReader(t *testing.T) {
	db := san_testdb.DB(t)
	seedLocks(t, db)
	svc := product_v1.NewService(db, history, teamCodes, nil, nil)

	for _, filter := range []*productv1.ProductListFilter{
		{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW},
		{StockAgeMinDays: 30},
	} {
		_, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
			TeamId: 2, Filter: filter, Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
		if codeOf(err) != connect.CodeUnavailable {
			t.Fatalf("%v without a reader: %v, want Unavailable", filter, err)
		}
	}

	failing := product_v1.NewService(db, history, teamCodes, &fakeStock{err: errors.New("down")}, nil)

	_, err := failing.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: 2, Filter: &productv1.ProductListFilter{StockAgeMinDays: 30}, Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
	}))
	if codeOf(err) != connect.CodeInternal {
		t.Fatalf("a failing reader: %v, want Internal", err)
	}
}

// Discover's Kunci values (CLOSED, ORDERABLE — discover-filters-by-lock) are not the list's: the list's Terbuka is the
// setting, Discover's what another team may take now. Refused rather than ignored.
func TestProductList_RefusesDiscoversLockValues(t *testing.T) {
	db := san_testdb.DB(t)
	seedLocks(t, db)
	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{}, nil)

	for _, lock := range []productv1.ProductLockFilter{
		productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED,
		productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_ORDERABLE,
	} {
		_, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
			TeamId: 2, Filter: &productv1.ProductListFilter{Lock: lock}, Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
		if codeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ProductList with %v: %v, want InvalidArgument", lock, err)
		}
	}
}
