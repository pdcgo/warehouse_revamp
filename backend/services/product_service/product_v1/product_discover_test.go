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
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// Discover is CROSS-team (#106): it returns products from every team, regardless of the caller's team
// (team_id only authorizes the request; it does not scope the results).
func TestProductDiscover_CrossTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha")
	insertProduct(t, db, 3, "B-1", "Beta")  // another team
	insertProduct(t, db, 4, "C-1", "Gamma") // yet another team

	// Caller is team 2, but discover returns all three teams' products.
	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 2,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("discover total = %d, want 3 (all teams)", resp.Msg.GetPageInfo().GetTotalItems())
	}

	// q filters across teams too.
	q, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 2,
		Filter: &productv1.ProductListFilter{Q: "Beta"},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(q): %v", err)
	}
	rows := listRows(q.Msg.GetItems())
	if q.Msg.GetPageInfo().GetTotalItems() != 1 || len(q.Msg.GetIds()) != 1 || rows[q.Msg.GetIds()[0]].GetTeamId() != 3 {
		t.Fatalf("q=Beta should find team 3's product; got %d items", q.Msg.GetPageInfo().GetTotalItems())
	}
}

// `exclude_own_team` is what lets a picker offer "my products" and "other teams' products" as two
// tabs without the same row appearing in both.
//
// It also has to hold on the COUNT, not just the rows: the list is paginated, so a filter that
// narrowed the page while `total_items` kept counting the excluded rows would give the pager pages
// that do not exist. That is the half a client-side filter cannot do, and the reason this is here.
func TestProductDiscover_ExcludeOwnTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha") // the caller's own
	insertProduct(t, db, 3, "B-1", "Beta")
	insertProduct(t, db, 4, "C-1", "Gamma")

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:         2,
		ExcludeOwnTeam: true,
		Page:           &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total = %d, want 2 — the count must exclude own-team rows too, not just the page",
			resp.Msg.GetPageInfo().GetTotalItems())
	}

	rows := listRows(resp.Msg.GetItems())
	for _, id := range resp.Msg.GetIds() {
		if rows[id].GetTeamId() == 2 {
			t.Fatalf("product %d belongs to the calling team and should have been excluded", id)
		}
	}

	// Unset, the behaviour is unchanged: everybody's, including mine.
	all, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: 2,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(all): %v", err)
	}
	if all.Msg.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("total without the flag = %d, want 3", all.Msg.GetPageInfo().GetTotalItems())
	}
}

// `owner_team_id` narrows discovery to ONE team's catalogue — the lens for "I know whose product I
// want". Asserted on the count as well as the rows, for the same reason as the exclusion above: the
// pager reads the count, so a filter the count cannot see offers pages that are not there.
func TestProductDiscover_OwnerTeamFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha")
	insertProduct(t, db, 3, "B-1", "Beta")
	insertProduct(t, db, 3, "B-2", "Beta two")
	insertProduct(t, db, 4, "C-1", "Gamma")

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:         2,
		ExcludeOwnTeam: true,
		OwnerTeamId:    3,
		Page:           &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total = %d, want 2 (team 3 only)", resp.Msg.GetPageInfo().GetTotalItems())
	}

	rows := listRows(resp.Msg.GetItems())
	for _, id := range resp.Msg.GetIds() {
		if rows[id].GetTeamId() != 3 {
			t.Fatalf("product %d belongs to team %d, want only team 3", id, rows[id].GetTeamId())
		}
	}

	// Naming your OWN team while excluding it is a contradiction, and the honest answer is "nothing"
	// rather than an error — the two filters simply intersect.
	none, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:         2,
		ExcludeOwnTeam: true,
		OwnerTeamId:    2,
		Page:           &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(contradiction): %v", err)
	}
	if none.Msg.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("total = %d, want 0", none.Msg.GetPageInfo().GetTotalItems())
	}
}

// The PRIORITY partition (owner). Priority is a flag on the TEAM, held in team_service — a service
// this one must not join to (HARD RULE 3). So the caller resolves which teams are priority and hands
// the ids over; these two filters are the two halves the picker's tabs need.
func TestProductDiscover_OwnerTeamIds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha") // the caller's own
	insertProduct(t, db, 3, "B-1", "Beta")  // a priority team
	insertProduct(t, db, 4, "C-1", "Gamma") // an ordinary other team

	// THE PRIORITY TAB: only the named teams' products.
	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:         2,
		ExcludeOwnTeam: true,
		OwnerTeamIds:   []uint64{3},
		Page:           &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	rows := listRows(resp.Msg.GetItems())
	if resp.Msg.GetPageInfo().GetTotalItems() != 1 || len(resp.Msg.GetIds()) != 1 {
		t.Fatalf("owner_team_ids=[3] returned %d items, want 1", resp.Msg.GetPageInfo().GetTotalItems())
	}
	if got := rows[resp.Msg.GetIds()[0]].GetTeamId(); got != 3 {
		t.Errorf("returned team %d, want 3", got)
	}
}

// …and its complement. The two tabs are two halves of ONE partition, so the same id list drives both
// — which is what stops a priority product being listed on the Priority tab AND the Other tab, where
// ticking it once would show it ticked twice.
func TestProductDiscover_ExcludeOwnerTeamIds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha") // the caller's own
	insertProduct(t, db, 3, "B-1", "Beta")  // a priority team
	insertProduct(t, db, 4, "C-1", "Gamma") // an ordinary other team

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:              2,
		ExcludeOwnTeam:      true,
		ExcludeOwnerTeamIds: []uint64{3},
		Page:                &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	// Neither the caller's own (excluded by exclude_own_team) nor the priority team's.
	rows := listRows(resp.Msg.GetItems())
	if resp.Msg.GetPageInfo().GetTotalItems() != 1 || len(resp.Msg.GetIds()) != 1 {
		t.Fatalf("exclude_owner_team_ids=[3] returned %d items, want 1", resp.Msg.GetPageInfo().GetTotalItems())
	}
	if got := rows[resp.Msg.GetIds()[0]].GetTeamId(); got != 4 {
		t.Errorf("returned team %d, want 4", got)
	}
}

// ⚠ AN EMPTY LIST IS NO NARROWING, on both fields — the same convention `owner_team_id = 0` follows.
//
// Worth a test of its own because the failure is silent and inverted: a caller whose priority set is
// empty and which sends `owner_team_ids: []` anyway gets the WHOLE catalogue, and a Priority tab
// showing everything reads as "all of this is priority" rather than as a bug. The contract is what it
// is; the caller is required to render nothing itself, and this pins the behaviour it must work
// around rather than pretending the empty list filters.
func TestProductDiscover_EmptyTeamIdListsDoNotNarrow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 2, "A-1", "Alpha")
	insertProduct(t, db, 3, "B-1", "Beta")
	insertProduct(t, db, 4, "C-1", "Gamma")

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:              2,
		OwnerTeamIds:        []uint64{},
		ExcludeOwnerTeamIds: []uint64{},
		Page:                &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	if got := resp.Msg.GetPageInfo().GetTotalItems(); got != 3 {
		t.Errorf("empty lists returned %d items, want all 3 (no narrowing)", got)
	}
}

// The narrowings INTERSECT rather than override — naming a team on one list and excluding it on the
// other returns nothing, which is the honest answer to a contradictory ask rather than an error.
func TestProductDiscover_TeamIdListsIntersect(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertProduct(t, db, 3, "B-1", "Beta")

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:              2,
		OwnerTeamIds:        []uint64{3},
		ExcludeOwnerTeamIds: []uint64{3},
		Page:                &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover: %v", err)
	}

	if got := resp.Msg.GetPageInfo().GetTotalItems(); got != 0 {
		t.Errorf("contradictory lists returned %d items, want 0", got)
	}
}

// The list's lock ways, its lock-now and the stock age belong to a team's own list: Discover's Kunci is its own two values
// (discover-filters-by-lock). Refused rather than ignored, so nobody reads an unnarrowed page as narrowed.
func TestProductDiscover_RefusesTheListOnlyFilters(t *testing.T) {
	db := san_testdb.DB(t)
	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{}, nil)

	for _, filter := range []*productv1.ProductListFilter{
		{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_OPEN},
		{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_MINIMUM},
		{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_ALWAYS},
		{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW},
		{StockAgeMinDays: 30},
	} {
		_, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
			TeamId: 2, Filter: filter, Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
		if codeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("Discover with %v: %v, want InvalidArgument", filter, err)
		}
	}
}

// ── Discover's Kunci (discover-filters-by-lock, a-minimum-closes-only-under-it) ─────────────────────────────────────────
//
// seedLocks' catalogue: team 2's open, minA (20), minB (5), always (locked, keeps a minimum of 3), an archived minimum,
// and team 3's minimum product (9). The seam is faked; the real one over real batches — exactly at the minimum, two
// teams — is cmd/app_development/product_discover_lock_test.go.

var (
	kunciClosed    = productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED
	kunciOrderable = productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_ORDERABLE
)

// discoverIDs runs ProductDiscover over the fixture's two teams and returns its page's ids (sorted) and its total.
func discoverIDs(
	t *testing.T,
	svc *product_v1.Service,
	lock productv1.ProductLockFilter,
	q string,
	includeLocked bool,
) ([]uint64, uint64) {
	t.Helper()

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:        2,
		Filter:        &productv1.ProductListFilter{Lock: lock, Q: q},
		OwnerTeamIds:  []uint64{2, 3},
		IncludeLocked: includeLocked,
		Page:          &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(%v, q %q): %v", lock, q, err)
	}

	return sorted(resp.Msg.GetIds()...), resp.Msg.GetPageInfo().GetTotalItems()
}

// TERKUNCI = locked by its owner OR a minimum inventory says is in force; TERBUKA = every other. The candidates are
// EVERY team's live minimum products in one ask, each with its owner and minimum. An id that came back but is not a
// minimum product (the open one) is read by its lock now: never Terkunci, still Terbuka.
func TestProductDiscover_KunciSplitsClosedFromOrderable(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedLocks(t, db)
	stock := &fakeStock{closed: []uint64{f.minA, f.theirs, f.open}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	ids, total := discoverIDs(t, svc, kunciClosed, "", true)
	if !reflect.DeepEqual(ids, sorted(f.always, f.minA, f.theirs)) || total != 3 {
		t.Fatalf("Terkunci: %v (total %d), want the locked one and the two minimums in force", ids, total)
	}

	want := []product_v1.MinimumCandidate{
		{TeamID: 2, ProductID: f.minA, Minimum: 20},
		{TeamID: 2, ProductID: f.minB, Minimum: 5},
		{TeamID: 3, ProductID: f.theirs, Minimum: 9},
	}

	got := slices.Clone(stock.candidates)
	slices.SortFunc(got, func(a, b product_v1.MinimumCandidate) int { return int(a.ProductID) - int(b.ProductID) })

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("candidates = %+v, want both teams' live minimum products in one ask", got)
	}

	ids, total = discoverIDs(t, svc, kunciOrderable, "", true)
	if !reflect.DeepEqual(ids, sorted(f.open, f.minB)) || total != 2 {
		t.Fatalf("Terbuka: %v (total %d), want the open one and the minimum with enough stock", ids, total)
	}

	// Terkunci + Terbuka is the whole grid, nothing twice.
	all, allTotal := discoverIDs(t, svc, productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_UNSPECIFIED, "", true)
	if allTotal != 5 || len(all) != 5 {
		t.Fatalf("the grid: %v (total %d), want 5 = 3 Terkunci + 2 Terbuka", all, allTotal)
	}

	// The search narrows the candidates too: Celana only.
	stock.candidates = nil
	stock.closed = []uint64{f.minB}

	ids, _ = discoverIDs(t, svc, kunciClosed, "celana", true)
	if !reflect.DeepEqual(ids, []uint64{f.minB}) || len(stock.candidates) != 1 || stock.candidates[0].ProductID != f.minB {
		t.Fatalf("Terkunci + q=celana: %v, candidates %+v — want Celana Minimum alone", ids, stock.candidates)
	}
}

// A PICKER (no include_locked) never sees the owner-locked product, under either value.
func TestProductDiscover_KunciKeepsThePickersLockOut(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedLocks(t, db)
	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{closed: []uint64{f.minA}}, nil)

	ids, _ := discoverIDs(t, svc, kunciClosed, "", false)
	if !reflect.DeepEqual(ids, []uint64{f.minA}) {
		t.Fatalf("Terkunci without include_locked: %v, want only the minimum in force", ids)
	}

	ids, _ = discoverIDs(t, svc, kunciOrderable, "", false)
	if !reflect.DeepEqual(ids, sorted(f.open, f.minB, f.theirs)) {
		t.Fatalf("Terbuka without include_locked: %v", ids)
	}
}

// No minimum in force: Terkunci is the owner-locked alone, Terbuka every product not locked.
func TestProductDiscover_KunciWithNothingInForce(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedLocks(t, db)
	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{}, nil)

	ids, total := discoverIDs(t, svc, kunciClosed, "", true)
	if !reflect.DeepEqual(ids, []uint64{f.always}) || total != 1 {
		t.Fatalf("Terkunci, nothing in force: %v (total %d), want the locked one", ids, total)
	}

	ids, total = discoverIDs(t, svc, kunciOrderable, "", true)
	if !reflect.DeepEqual(ids, sorted(f.open, f.minA, f.minB, f.theirs)) || total != 4 {
		t.Fatalf("Terbuka, nothing in force: %v (total %d)", ids, total)
	}
}

// The narrowed grid still counts and pages as one list, and a page past the end still says the total.
func TestProductDiscover_KunciPagesAndCounts(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedLocks(t, db)
	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{closed: []uint64{f.minA, f.theirs}}, nil)

	page := func(n uint32) ([]uint64, *commonv1.PageInfo) {
		resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
			TeamId:        2,
			Filter:        &productv1.ProductListFilter{Lock: kunciClosed},
			OwnerTeamIds:  []uint64{2, 3},
			IncludeLocked: true,
			Page:          &commonv1.CommonPagination{Page: n, Limit: 2},
		}))
		if err != nil {
			t.Fatalf("page %d: %v", n, err)
		}

		return resp.Msg.GetIds(), resp.Msg.GetPageInfo()
	}

	first, info := page(1)
	second, _ := page(2)

	if info.GetTotalItems() != 3 || info.GetTotalPage() != 2 || len(first) != 2 || len(second) != 1 {
		t.Fatalf("pages %v + %v, total %d over %d pages — want 2 + 1, 3 over 2", first, second, info.GetTotalItems(), info.GetTotalPage())
	}

	if !reflect.DeepEqual(sorted(append(first, second...)...), sorted(f.always, f.minA, f.theirs)) {
		t.Fatalf("across pages %v", append(first, second...))
	}

	past, info := page(5)
	if len(past) != 0 || info.GetTotalItems() != 3 {
		t.Fatalf("page 5: %v, total %d — want none, 3", past, info.GetTotalItems())
	}
}

// Without a stock reader Kunci is refused (Unavailable) — never answered unnarrowed; a reader's failure is Internal.
func TestProductDiscover_KunciNeedsTheReader(t *testing.T) {
	db := san_testdb.DB(t)
	seedLocks(t, db)

	_, err := product_v1.NewService(db, history, teamCodes, nil, nil).
		ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
			TeamId: 2, Filter: &productv1.ProductListFilter{Lock: kunciClosed}, Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
	if codeOf(err) != connect.CodeUnavailable {
		t.Fatalf("Kunci without a reader: %v, want Unavailable", err)
	}

	_, err = product_v1.NewService(db, history, teamCodes, &fakeStock{err: errors.New("down")}, nil).
		ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
			TeamId: 2, Filter: &productv1.ProductListFilter{Lock: kunciOrderable}, Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
	if codeOf(err) != connect.CodeInternal {
		t.Fatalf("a failing reader: %v, want Internal", err)
	}
}

// ── Discover's Gudang, Stok siap, Harga cross and Kategori (discovers-warehouse-keeps-ready-stock-there,
// discover-ranges-are-picked, a-cross-band-keeps-a-range-that-touches-it, a-picked-branch-keeps-its-whole-subtree) ──────
//
// The seams are faked: the shelves answer what they are given, so these pin what THIS service asks and what it does
// with the answer — the pair match, the complement of a range from 0, the exact cross test with its own markup, the
// subtree. The real shelves and tree over real rows are cmd/app_development/product_discover_filters_test.go.

// fakeCategories answers the tree from a fixed map and records what it was asked.
type fakeCategories struct {
	tree  map[uint64][]uint64
	err   error
	asked []uint64
}

func (f *fakeCategories) SubtreeIDs(_ context.Context, categoryID uint64) ([]uint64, error) {
	f.asked = append(f.asked, categoryID)

	return f.tree[categoryID], f.err
}

// shelfFixture: team 2's kaos (markup 10%), celana (0%), topi (25%), jaket (10%) and a never-stocked one; team 3's
// sinars (10%). Categories: kaos 10, celana 11 (under 10), topi 12 (under 11), sinars 13 (another branch).
type shelfFixture struct {
	kaos, celana, topi, jaket, none, sinars uint64
}

func seedShelf(t *testing.T, db *gorm.DB) shelfFixture {
	t.Helper()

	f := shelfFixture{
		kaos:   insertProduct(t, db, 2, "T2-SH-KAOS", "Kaos Rak"),
		celana: insertProduct(t, db, 2, "T2-SH-CEL", "Celana Rak"),
		topi:   insertProduct(t, db, 2, "T2-SH-TOPI", "Topi Rak"),
		jaket:  insertProduct(t, db, 2, "T2-SH-JKT", "Jaket Rak"),
		none:   insertProduct(t, db, 2, "T2-SH-NONE", "Belum Pernah Ada"),
		sinars: insertProduct(t, db, 3, "T3-SH-KAOS", "Kaos Sinar"),
	}

	for id, bps := range map[uint64]int{f.kaos: 1000, f.celana: 0, f.topi: 2500, f.jaket: 1000, f.none: 0, f.sinars: 1000} {
		setProduct(t, db, id, "cross_markup_bps", bps)
	}

	for id, category := range map[uint64]int{f.kaos: 10, f.celana: 11, f.topi: 12, f.sinars: 13} {
		setProduct(t, db, id, "category_id", category)
	}

	return f
}

// shelved is the shelves' answer: every product with ready units, each with its cost spread.
func (f shelfFixture) shelved() []product_v1.ShelvedProduct {
	return []product_v1.ShelvedProduct{
		{TeamID: 2, ProductID: f.kaos, CostMin: 10000, CostMax: 20000},    // cross 11 000 – 22 000
		{TeamID: 2, ProductID: f.celana, CostMin: 25000, CostMax: 25000},  // cross 25 000
		{TeamID: 2, ProductID: f.topi, CostMin: 8000, CostMax: 8000},      // cross 10 000
		{TeamID: 2, ProductID: f.jaket, CostMin: 550000, CostMax: 550000}, // cross 605 000 — past every band's ceiling
		{TeamID: 3, ProductID: f.sinars, CostMin: 30000, CostMax: 40000},  // cross 33 000 – 44 000
	}
}

// shelfDiscover runs ProductDiscover over the fixture's two teams with the request shaped by `set`.
func shelfDiscover(t *testing.T, svc *product_v1.Service, set func(*productv1.ProductDiscoverRequest)) ([]uint64, uint64) {
	t.Helper()

	req := &productv1.ProductDiscoverRequest{
		TeamId:       2,
		OwnerTeamIds: []uint64{2, 3},
		Page:         &commonv1.CommonPagination{Page: 1, Limit: 50},
	}
	set(req)

	resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ProductDiscover(%v): %v", req, err)
	}

	return sorted(resp.Msg.GetIds()...), resp.Msg.GetPageInfo().GetTotalItems()
}

func i64p(v int64) *int64 { return &v }

func f64p(v float64) *float64 { return &v }

// GUDANG keeps what the shelves say holds ready units there — matched on the owner AND the id, so a pair naming another
// team's owner keeps nothing. Every team's products in ONE ask, with the warehouse and nothing else.
func TestProductDiscover_GudangKeepsWhatTheShelvesHold(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedShelf(t, db)
	stock := &fakeStock{shelved: []product_v1.ShelvedProduct{
		{TeamID: 2, ProductID: f.kaos},
		{TeamID: 2, ProductID: f.topi},
		{TeamID: 3, ProductID: f.sinars},
		{TeamID: 3, ProductID: f.celana}, // celana is team 2's — this pair is not its stock
	}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	ids, total := shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) { r.WarehouseId = 77 })
	if !reflect.DeepEqual(ids, sorted(f.kaos, f.topi, f.sinars)) || total != 3 {
		t.Fatalf("Gudang 77: %v (total %d), want kaos, topi and Sinar's", ids, total)
	}

	if want := []product_v1.ShelfAsk{{WarehouseID: 77}}; !reflect.DeepEqual(stock.shelfAsks, want) || len(stock.aboveAsks) != 0 {
		t.Fatalf("asked %+v / above %v, want one ask of warehouse 77 alone", stock.shelfAsks, stock.aboveAsks)
	}

	// Nothing there: the grid is empty, and still counts 0.
	stock.shelved = nil

	ids, total = shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) { r.WarehouseId = 77 })
	if len(ids) != 0 || total != 0 {
		t.Fatalf("an empty warehouse: %v (total %d)", ids, total)
	}
}

// STOK SIAP asks its range, both ends as given, with the warehouse when one is picked; the top band has no max.
func TestProductDiscover_StokSiapAsksItsRange(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedShelf(t, db)
	stock := &fakeStock{shelved: []product_v1.ShelvedProduct{{TeamID: 2, ProductID: f.kaos}}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	ids, _ := shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) {
		r.Ready = &productv1.DiscoverReadyRange{Min: 11, Max: i64p(50)}
	})
	if !reflect.DeepEqual(ids, []uint64{f.kaos}) {
		t.Fatalf("11–50: %v", ids)
	}

	shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) {
		r.Ready = &productv1.DiscoverReadyRange{Min: 10001} // the top band: open-ended
	})

	shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) {
		r.WarehouseId = 77
		r.Ready = &productv1.DiscoverReadyRange{Min: 0, Max: i64p(10)} // from 0 WITH a warehouse: one positive ask
	})

	want := []product_v1.ShelfAsk{
		{ReadyMin: i64p(11), ReadyMax: i64p(50)},
		{ReadyMin: i64p(10001)},
		{WarehouseID: 77, ReadyMax: i64p(10)},
	}

	if !reflect.DeepEqual(stock.shelfAsks, want) || len(stock.aboveAsks) != 0 {
		t.Fatalf("asked %+v / above %v, want %+v", stock.shelfAsks, stock.aboveAsks, want)
	}
}

// A RANGE FROM 0 keeps the products with NO stock row — it asks the opposite set (ready above its top) and drops that.
// From 0 with no top narrows nothing and asks nothing.
func TestProductDiscover_StokSiapFromZeroKeepsTheNeverStocked(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedShelf(t, db)
	stock := &fakeStock{above: []product_v1.ShelvedProduct{
		{TeamID: 2, ProductID: f.kaos},
		{TeamID: 3, ProductID: f.sinars},
		{TeamID: 3, ProductID: f.topi}, // another owner's units under topi's id: topi itself is not above
	}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	ids, total := shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) {
		r.Ready = &productv1.DiscoverReadyRange{Min: 0, Max: i64p(10)}
	})
	if !reflect.DeepEqual(ids, sorted(f.celana, f.topi, f.jaket, f.none)) || total != 4 {
		t.Fatalf("0–10: %v (total %d), want every product not above 10 — the never-stocked one included", ids, total)
	}

	// Kosong is 0–0: the same complement, at 0.
	shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) {
		r.Ready = &productv1.DiscoverReadyRange{Min: 0, Max: i64p(0)}
	})

	if !reflect.DeepEqual(stock.aboveAsks, []int64{10, 0}) || len(stock.shelfAsks) != 0 {
		t.Fatalf("above asks %v / shelf asks %+v, want 10 then 0 and no positive ask", stock.aboveAsks, stock.shelfAsks)
	}

	// From 0, open: every product, nothing asked — and no reader needed.
	ids, total = shelfDiscover(t, product_v1.NewService(db, history, teamCodes, nil, nil), func(r *productv1.ProductDiscoverRequest) {
		r.Ready = &productv1.DiscoverReadyRange{Min: 0}
	})
	if len(ids) != 6 || total != 6 {
		t.Fatalf("0 and up: %v (total %d), want all 6", ids, total)
	}
}

// HARGA CROSS: the overlap test runs HERE with each product's own markup — cross = cost + cost × bps ÷ 10 000 at both
// ends; kept when cross_min <= max AND cross_max >= min, both ends included. A product with nothing ready has no cross
// price and is never kept by any band, the one from 0 included.
func TestProductDiscover_HargaCrossTestsTheMarkupHere(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedShelf(t, db)
	stock := &fakeStock{shelved: f.shelved()}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	band := func(lo float64, hi *float64) []uint64 {
		ids, _ := shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) {
			r.CrossPrice = &productv1.DiscoverPriceRange{Min: lo, Max: hi}
		})

		return ids
	}

	cases := []struct {
		name string
		lo   float64
		hi   *float64
		want []uint64
	}{
		{"≤ 10rb — topi is exactly 10 000; never the unstocked one", 0, f64p(10000), []uint64{f.topi}},
		{"10–25rb — kaos 11–22rb inside, celana exactly 25 000, topi exactly 10 000", 10000, f64p(25000),
			sorted(f.kaos, f.celana, f.topi)},
		{"22–50rb — kaos's dearest is exactly 22 000", 22000, f64p(50000), sorted(f.kaos, f.celana, f.sinars)},
		{"a hair over 22 000 — kaos's range ends under it", 22000.01, f64p(50000), sorted(f.celana, f.sinars)},
		{"35–40rb — Sinar's 33–44rb straddles both edges", 35000, f64p(40000), []uint64{f.sinars}},
		{"up to 10 999,99 — kaos's cheapest (11 000) is past it", 0, f64p(10999.99), []uint64{f.topi}},
		{"500rb and up, the open top band — jaket's 605 000 is past the screen's ceiling", 500000, nil, []uint64{f.jaket}},
	}

	for _, c := range cases {
		if got := band(c.lo, c.hi); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%s: %v, want %v", c.name, got, c.want)
		}
	}

	// The cut it hands the shelves: MIN(cost) <= the band's max; MAX(cost) >= min ÷ (1 + the largest markup in the
	// scope, topi's 25%) — both widened by a billionth, never narrowed.
	stock.shelfAsks = nil
	band(22000, f64p(50000))

	ask := stock.shelfAsks[0]
	if ask.CostAtMost == nil || *ask.CostAtMost < 50000 || *ask.CostAtMost > 50000.001 {
		t.Fatalf("cost at most %v, want 50 000 (a hair over)", ask.CostAtMost)
	}

	if ask.CostAtLeast == nil || *ask.CostAtLeast > 17600 || *ask.CostAtLeast < 17599.99 {
		t.Fatalf("cost at least %v, want 22 000 ÷ 1.25 = 17 600 (a hair under)", ask.CostAtLeast)
	}

	stock.shelfAsks = nil
	band(500000, nil)

	if stock.shelfAsks[0].CostAtMost != nil {
		t.Fatalf("the open top band cut the cost at %v", *stock.shelfAsks[0].CostAtMost)
	}
}

// The three narrow together: the warehouse, the ready range and the cost cut in ONE ask of the shelves.
func TestProductDiscover_GudangStockAndCrossInOneAsk(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedShelf(t, db)
	stock := &fakeStock{shelved: f.shelved()}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	ids, total := shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) {
		r.WarehouseId = 77
		r.Ready = &productv1.DiscoverReadyRange{Min: 0, Max: i64p(10)}
		r.CrossPrice = &productv1.DiscoverPriceRange{Min: 0, Max: f64p(25000)}
	})
	if !reflect.DeepEqual(ids, sorted(f.kaos, f.celana, f.topi)) || total != 3 {
		t.Fatalf("Gudang + 0–10 + ≤ 25rb: %v (total %d)", ids, total)
	}

	if len(stock.shelfAsks) != 1 || len(stock.aboveAsks) != 0 {
		t.Fatalf("asks %+v / above %v, want one positive ask", stock.shelfAsks, stock.aboveAsks)
	}

	ask := stock.shelfAsks[0]
	if ask.WarehouseID != 77 || ask.ReadyMin != nil || ask.ReadyMax == nil || *ask.ReadyMax != 10 || ask.CostAtMost == nil ||
		ask.CostAtLeast != nil {
		t.Fatalf("the one ask: %+v", ask)
	}
}

// KATEGORI keeps the picked node's whole subtree, as the tree answers it; an unknown node keeps nothing.
func TestProductDiscover_KategoriKeepsTheSubtree(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedShelf(t, db)
	tree := &fakeCategories{tree: map[uint64][]uint64{10: {10, 11, 12}, 12: {12}, 13: {13}}}
	svc := product_v1.NewService(db, history, teamCodes, nil, tree)

	cases := []struct {
		name     string
		category uint64
		want     []uint64
	}{
		{"a branch — three levels", 10, sorted(f.kaos, f.celana, f.topi)},
		{"an end category", 12, []uint64{f.topi}},
		{"the other team's branch", 13, []uint64{f.sinars}},
		{"no such category", 99, []uint64{}},
	}

	for _, c := range cases {
		ids, total := shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) { r.CategoryId = c.category })
		if len(ids) != len(c.want) || (len(ids) > 0 && !reflect.DeepEqual(ids, c.want)) || total != uint64(len(c.want)) {
			t.Fatalf("%s: %v (total %d), want %v", c.name, ids, total, c.want)
		}
	}

	if !reflect.DeepEqual(tree.asked, []uint64{10, 12, 13, 99}) {
		t.Fatalf("the tree was asked %v, want once per request", tree.asked)
	}
}

// With Kunci: the subtree also narrows the lock's candidates — one ask, the category's products only.
func TestProductDiscover_KategoriNarrowsKunciCandidates(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedShelf(t, db)
	setProduct(t, db, f.kaos, "reserved_stock", 5)
	setProduct(t, db, f.sinars, "reserved_stock", 5)

	stock := &fakeStock{closed: []uint64{f.kaos}}
	svc := product_v1.NewService(db, history, teamCodes, stock, &fakeCategories{tree: map[uint64][]uint64{10: {10, 11, 12}}})

	ids, _ := shelfDiscover(t, svc, func(r *productv1.ProductDiscoverRequest) {
		r.CategoryId = 10
		r.Filter = &productv1.ProductListFilter{Lock: kunciClosed}
	})
	if !reflect.DeepEqual(ids, []uint64{f.kaos}) {
		t.Fatalf("Kategori 10 + Terkunci: %v", ids)
	}

	if len(stock.candidates) != 1 || stock.candidates[0].ProductID != f.kaos {
		t.Fatalf("candidates %+v, want kaos alone — Sinar's minimum is in another branch", stock.candidates)
	}
}

// Without a reader the shelf and category filters are refused (Unavailable) — never answered unnarrowed; a reader's
// failure is Internal.
func TestProductDiscover_ShelfAndCategoryNeedTheirReaders(t *testing.T) {
	db := san_testdb.DB(t)
	seedShelf(t, db)

	ask := func(svc *product_v1.Service, set func(*productv1.ProductDiscoverRequest)) error {
		req := &productv1.ProductDiscoverRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 10}}
		set(req)

		_, err := svc.ProductDiscover(context.Background(), connect.NewRequest(req))

		return err
	}

	bare := product_v1.NewService(db, history, teamCodes, nil, nil)
	down := product_v1.NewService(db, history, teamCodes, &fakeStock{err: errors.New("down")},
		&fakeCategories{err: errors.New("down")})

	for _, c := range []struct {
		name string
		set  func(*productv1.ProductDiscoverRequest)
	}{
		{"Gudang", func(r *productv1.ProductDiscoverRequest) { r.WarehouseId = 77 }},
		{"Stok siap", func(r *productv1.ProductDiscoverRequest) { r.Ready = &productv1.DiscoverReadyRange{Min: 1} }},
		{"Stok siap from 0", func(r *productv1.ProductDiscoverRequest) {
			r.Ready = &productv1.DiscoverReadyRange{Min: 0, Max: i64p(10)}
		}},
		{"Harga cross", func(r *productv1.ProductDiscoverRequest) { r.CrossPrice = &productv1.DiscoverPriceRange{Min: 5} }},
		{"Kategori", func(r *productv1.ProductDiscoverRequest) { r.CategoryId = 10 }},
	} {
		err := ask(bare, c.set)
		if codeOf(err) != connect.CodeUnavailable {
			t.Fatalf("%s without a reader: %v, want Unavailable", c.name, err)
		}

		err = ask(down, c.set)
		if codeOf(err) != connect.CodeInternal {
			t.Fatalf("%s with a failing reader: %v, want Internal", c.name, err)
		}
	}
}

// The narrowed grid counts and pages as one list, a page past the end still says the total.
func TestProductDiscover_ShelfPagesAndCounts(t *testing.T) {
	db := san_testdb.DB(t)
	f := seedShelf(t, db)
	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{shelved: f.shelved()}, nil)

	page := func(n uint32) ([]uint64, uint64) {
		resp, err := svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
			TeamId:       2,
			OwnerTeamIds: []uint64{2, 3},
			WarehouseId:  77,
			Page:         &commonv1.CommonPagination{Page: n, Limit: 2},
		}))
		if err != nil {
			t.Fatalf("page %d: %v", n, err)
		}

		return resp.Msg.GetIds(), resp.Msg.GetPageInfo().GetTotalItems()
	}

	first, total := page(1)
	second, _ := page(2)
	third, _ := page(3)
	past, pastTotal := page(9)

	all := sorted(append(append(slices.Clone(first), second...), third...)...)
	if total != 5 || len(first) != 2 || len(second) != 2 || len(third) != 1 ||
		!reflect.DeepEqual(all, sorted(f.kaos, f.celana, f.topi, f.jaket, f.sinars)) {
		t.Fatalf("pages %v %v %v of %d", first, second, third, total)
	}

	if len(past) != 0 || pastTotal != 5 {
		t.Fatalf("page 9: %v, total %d", past, pastTotal)
	}
}
