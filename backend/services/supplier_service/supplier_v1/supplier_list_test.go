package supplier_v1_test

import (
	"context"
	"slices"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

func list(
	t *testing.T,
	svc *supplier_v1.Service,
	filter *supplierv1.SupplierListFilter,
	types ...supplierv1.SupplierListDataType,
) *supplierv1.SupplierListResponse {
	t.Helper()

	resp, err := svc.SupplierList(context.Background(), connect.NewRequest(&supplierv1.SupplierListRequest{
		TeamId:      sellingA,
		Filter:      filter,
		DataRequest: types,
		Page:        page(1, 50),
	}))
	if err != nil {
		t.Fatalf("SupplierList: %v", err)
	}

	return resp.Msg
}

// My Supplier: the caller's team's live suppliers only — never another team's, never a deleted one.
func TestSupplierList_OwnScopeIsMyLiveSuppliers(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := insertSupplier(t, db, sellingA, "Mine")
	gone := insertSupplier(t, db, sellingA, "Gone")
	insertSupplier(t, db, sellingB, "Theirs")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)

	got := list(t, svc, nil)
	if !slices.Equal(got.GetIds(), []uint64{mine.ID}) || got.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("own scope ids = %v (total %d), want [%d]", got.GetIds(), got.GetPageInfo().GetTotalItems(), mine.ID)
	}
}

// Discover: every team's live suppliers, newest first.
func TestSupplierList_EveryTeamScopeCrossesTeams(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := insertSupplier(t, db, sellingA, "Mine")
	theirs := insertSupplier(t, db, sellingB, "Theirs")
	gone := insertSupplier(t, db, sellingB, "Gone")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)

	got := list(t, svc, &supplierv1.SupplierListFilter{Scope: supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM})
	if !slices.Equal(got.GetIds(), []uint64{theirs.ID, mine.ID}) {
		t.Fatalf("every-team ids = %v, want [%d %d]", got.GetIds(), theirs.ID, mine.ID)
	}
}

// Discover's Team filter: only the suppliers one team keeps, its deleted ones still left out
// (discover-filters-by-the-team-that-keeps-it). Under OWN it can only agree with the scope or narrow to nothing.
func TestSupplierList_OwnerTeamFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertSupplier(t, db, sellingA, "Mine")
	theirs := insertSupplier(t, db, sellingB, "Theirs")
	gone := insertSupplier(t, db, sellingB, "Gone")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)

	got := list(t, svc, &supplierv1.SupplierListFilter{
		Scope:       supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM,
		OwnerTeamId: sellingB,
	})
	if !slices.Equal(got.GetIds(), []uint64{theirs.ID}) || got.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("owner team B ids = %v (total %d), want [%d]", got.GetIds(), got.GetPageInfo().GetTotalItems(), theirs.ID)
	}

	own := list(t, svc, &supplierv1.SupplierListFilter{OwnerTeamId: sellingB})
	if len(own.GetIds()) != 0 {
		t.Fatalf("OWN scope narrowed to another team = %v, want none", own.GetIds())
	}
}

// q reads the name, the address, the contact — and the live stores' names, not a deleted store's.
func TestSupplierList_SearchReachesTheStores(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	byName := insertSupplier(t, db, sellingA, "Kain Indah")
	byStore := insertSupplier(t, db, sellingA, "PT Lain")
	insertChannel(t, db, byStore.ID, "shopee", "Kain Grosir Official")
	byDeletedStore := insertSupplier(t, db, sellingA, "PT Ketiga")
	deadStore := insertChannel(t, db, byDeletedStore.ID, "shopee", "Kain Lama")
	softDelete(t, db, &supplier_service_models.SupplierChannel{}, deadStore.ID)
	insertSupplier(t, db, sellingA, "Benang Jaya")

	got := list(t, svc, &supplierv1.SupplierListFilter{Q: "kain"})
	if !slices.Equal(got.GetIds(), []uint64{byStore.ID, byName.ID}) {
		t.Fatalf("q=kain ids = %v, want [%d %d]", got.GetIds(), byStore.ID, byName.ID)
	}

	// A "%" is a character to find, not a wildcard.
	if got := list(t, svc, &supplierv1.SupplierListFilter{Q: "%"}); len(got.GetIds()) != 0 {
		t.Fatalf("q=%% matched %v", got.GetIds())
	}
}

// channel_type keeps suppliers with at least one LIVE store of that type.
func TestSupplierList_ChannelTypeFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	onShopee := insertSupplier(t, db, sellingA, "On Shopee")
	insertChannel(t, db, onShopee.ID, "shopee", "Store")
	onTiktok := insertSupplier(t, db, sellingA, "On TikTok")
	insertChannel(t, db, onTiktok.ID, "tiktok", "Store")
	wasShopee := insertSupplier(t, db, sellingA, "Was on Shopee")
	old := insertChannel(t, db, wasShopee.ID, "shopee", "Old store")
	softDelete(t, db, &supplier_service_models.SupplierChannel{}, old.ID)

	got := list(t, svc, &supplierv1.SupplierListFilter{ChannelType: marketplacev1.Marketplace_MARKETPLACE_SHOPEE})
	if !slices.Equal(got.GetIds(), []uint64{onShopee.ID}) {
		t.Fatalf("shopee ids = %v, want [%d]", got.GetIds(), onShopee.ID)
	}
}

// The CHANNELS slice: every supplier on the page gets its live stores — an empty set included.
func TestSupplierList_ChannelsSlice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	withStores := insertSupplier(t, db, sellingA, "With stores")
	a := insertChannel(t, db, withStores.ID, "shopee", "A")
	b := insertChannel(t, db, withStores.ID, "other", "b.example")
	dead := insertChannel(t, db, withStores.ID, "tiktok", "Dead")
	softDelete(t, db, &supplier_service_models.SupplierChannel{}, dead.ID)
	bare := insertSupplier(t, db, sellingA, "Bare")

	got := list(t, svc, nil,
		supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_SUPPLIER,
		supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_CHANNELS,
	)

	var channels map[uint64]*supplierv1.SupplierChannelSet

	for _, item := range got.GetItems() {
		if m := item.GetChannels(); m != nil {
			channels = m.GetMapData()
		}
	}

	if channels == nil {
		t.Fatal("no CHANNELS slice in the response")
	}

	var ids []uint64
	for _, c := range channels[withStores.ID].GetChannels() {
		ids = append(ids, c.GetId())
	}

	if !slices.Equal(ids, []uint64{a.ID, b.ID}) {
		t.Fatalf("stores of %d = %v, want [%d %d]", withStores.ID, ids, a.ID, b.ID)
	}

	if channels[withStores.ID].GetChannels()[1].GetChannelType() != marketplacev1.Marketplace_MARKETPLACE_OTHER {
		t.Fatal("a stored `other` must read back as MARKETPLACE_OTHER")
	}

	set, ok := channels[bare.ID]
	if !ok || len(set.GetChannels()) != 0 {
		t.Fatalf("a supplier with no stores must answer an empty set, got %v (present %v)", set, ok)
	}
}

func TestSupplierList_Pages(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, name := range []string{"A", "B", "C"} {
		insertSupplier(t, db, sellingA, name)
	}

	resp, err := svc.SupplierList(context.Background(), connect.NewRequest(&supplierv1.SupplierListRequest{
		TeamId: sellingA, Page: page(2, 2),
	}))
	if err != nil {
		t.Fatalf("SupplierList page 2: %v", err)
	}

	info := resp.Msg.GetPageInfo()
	if len(resp.Msg.GetIds()) != 1 || info.GetTotalItems() != 3 || info.GetTotalPage() != 2 || info.GetCurrentPage() != 2 {
		t.Fatalf("page 2 = %d ids, info %+v", len(resp.Msg.GetIds()), info)
	}
}

// THE RANGE PILLS NARROW ON THE SERVER, BEFORE THE PAGE (the-range-pills-are-a-fixed-set): 30 suppliers, by name; the
// only one selling 1.000–2.500 sorts last, on page 2 of 25 — the band finds it on page 1 and counts one item.
func TestSupplierList_ABandFindsASupplierBeyondTheFirstPage(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{sold: map[uint64]int64{}, ready: map[uint64]int64{}}
	svc := supplier_v1.NewService(db, nil, nil, goods)

	var last supplier_service_models.Supplier
	for i := range 30 {
		last = insertSupplier(t, db, sellingA, "Pemasok "+string(rune('A'+i/26))+string(rune('a'+i%26)))
		goods.sold[last.ID] = int64(i * 10)
	}

	goods.sold[last.ID] = 1_200

	all, err := svc.SupplierList(context.Background(), connect.NewRequest(&supplierv1.SupplierListRequest{
		TeamId: sellingA, Page: page(1, 25),
		Sort: &supplierv1.SupplierListFilterSort{SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC, S: &supplierv1.SupplierListFilterSort_Supplier{
			Supplier: supplierv1.SupplierRowSort_SUPPLIER_ROW_SORT_NAME,
		}},
	}))
	if err != nil {
		t.Fatalf("SupplierList: %v", err)
	}

	if slices.Contains(all.Msg.GetIds(), last.ID) {
		t.Fatalf("the last supplier is already on page 1 — the fixture proves nothing")
	}

	got, err := svc.SupplierList(context.Background(), connect.NewRequest(&supplierv1.SupplierListRequest{
		TeamId: sellingA, Page: page(1, 25),
		Filter: &supplierv1.SupplierListFilter{Sold: &supplierv1.SupplierFigureBand{Min: 1_000, Max: 2_500}},
	}))
	if err != nil {
		t.Fatalf("SupplierList with a band: %v", err)
	}

	if ids := got.Msg.GetIds(); len(ids) != 1 || ids[0] != last.ID || got.Msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("Terjual 1.000–2.500 = %v (total %d), want only %d", ids, got.Msg.GetPageInfo().GetTotalItems(), last.ID)
	}
}

// A BAND'S EDGES: the bottom is in, the top is out; a band from 0 keeps a supplier that never sold (inventory lists only
// suppliers with goods, so it is asked as its complement); an empty band is no supplier; Terjual and Siap AND.
func TestSupplierList_BandsAreLowerInclusiveUpperExclusive(t *testing.T) {
	db := san_testdb.DB(t)

	never := insertSupplier(t, db, sellingA, "Belum Pernah")
	at500 := insertSupplier(t, db, sellingA, "Tepat 500")
	at499 := insertSupplier(t, db, sellingA, "Kurang Satu")
	big := insertSupplier(t, db, sellingA, "Besar")

	goods := &fakeGoods{
		sold:  map[uint64]int64{at500.ID: 500, at499.ID: 499, big.ID: 5_000},
		ready: map[uint64]int64{at500.ID: 50, at499.ID: 10, big.ID: 49},
	}
	svc := supplier_v1.NewService(db, nil, nil, goods)

	band := func(lo, hi int64) *supplierv1.SupplierFigureBand {
		return &supplierv1.SupplierFigureBand{Min: lo, Max: hi}
	}

	cases := []struct {
		name  string
		sold  *supplierv1.SupplierFigureBand
		ready *supplierv1.SupplierFigureBand
		want  []uint64
	}{
		{"< 500 keeps 499 and the never-sold", band(0, 500), nil, []uint64{never.ID, at499.ID}},
		{"500–1.000 starts at 500", band(500, 1_000), nil, []uint64{at500.ID}},
		{"≥ 5.000 is open-ended", band(5_000, 0), nil, []uint64{big.ID}},
		{"2.500–5.000 is empty", band(2_500, 5_000), nil, nil},
		{"Siap ≥ 50 and Terjual < 1.000", band(0, 1_000), band(50, 0), []uint64{at500.ID}},
		{"Semua", nil, nil, []uint64{never.ID, at500.ID, at499.ID, big.ID}},
	}

	for _, c := range cases {
		got := list(t, svc, &supplierv1.SupplierListFilter{Sold: c.sold, Ready: c.ready}).GetIds()
		slices.Sort(got)

		want := slices.Clone(c.want)
		slices.Sort(want)

		if !slices.Equal(got, want) {
			t.Fatalf("%s = %v, want %v", c.name, got, want)
		}
	}

	// Inventory not answering is an error, never an empty list.
	goods.err = errTeamServiceDown

	_, err := svc.SupplierList(context.Background(), connect.NewRequest(&supplierv1.SupplierListRequest{
		TeamId: sellingA, Page: page(1, 50), Filter: &supplierv1.SupplierListFilter{Sold: band(0, 500)},
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("a band with inventory down = %v, want Internal", err)
	}
}

// A band's top must sit above its bottom, or be 0 (open-ended); neither edge is negative — the proto's own rules, which
// the interceptor applies before the handler runs.
func TestSupplierList_ABandIsValidated(t *testing.T) {
	cases := []struct {
		band *supplierv1.SupplierFigureBand
		ok   bool
	}{
		{&supplierv1.SupplierFigureBand{Min: 500, Max: 1_000}, true},
		{&supplierv1.SupplierFigureBand{Min: 5_000}, true},
		{&supplierv1.SupplierFigureBand{Min: 1_000, Max: 1_000}, false},
		{&supplierv1.SupplierFigureBand{Min: 1_000, Max: 500}, false},
		{&supplierv1.SupplierFigureBand{Min: -1, Max: 500}, false},
	}

	for _, c := range cases {
		err := protovalidate.Validate(&supplierv1.SupplierListRequest{
			TeamId: sellingA, Page: page(1, 50), Filter: &supplierv1.SupplierListFilter{Sold: c.band},
		})
		if (err == nil) != c.ok {
			t.Fatalf("band [%d, %d): err %v, want ok=%v", c.band.GetMin(), c.band.GetMax(), err, c.ok)
		}
	}
}
