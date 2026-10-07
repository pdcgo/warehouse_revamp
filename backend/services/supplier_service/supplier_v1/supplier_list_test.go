package supplier_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

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
