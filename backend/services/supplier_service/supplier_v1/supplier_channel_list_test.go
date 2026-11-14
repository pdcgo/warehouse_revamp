package supplier_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

func channelList(
	t *testing.T,
	svc *supplier_v1.Service,
	filter *supplierv1.SupplierChannelListFilter,
) (*supplierv1.SupplierChannelListResponse, error) {
	t.Helper()

	resp, err := svc.SupplierChannelList(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelListRequest{
		TeamId: sellingA,
		Filter: filter,
		Page:   page(1, 50),
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

// Any team's live supplier's live stores — the Discover detail's Channels tab reads another team's.
func TestSupplierChannelList_AnotherTeamsLiveStores(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertSupplier(t, db, sellingB, "Theirs")
	a := insertChannel(t, db, theirs.ID, "shopee", "A")
	dead := insertChannel(t, db, theirs.ID, "tiktok", "Dead")
	softDelete(t, db, &supplier_service_models.SupplierChannel{}, dead.ID)

	got, err := channelList(t, svc, &supplierv1.SupplierChannelListFilter{SupplierId: theirs.ID})
	if err != nil {
		t.Fatalf("SupplierChannelList: %v", err)
	}

	if !slices.Equal(got.GetIds(), []uint64{a.ID}) || got.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("ids = %v, want [%d]", got.GetIds(), a.ID)
	}

	row := got.GetItems()[0].GetSupplierChannel().GetMapData()[a.ID]
	if row.GetChannelType() != marketplacev1.Marketplace_MARKETPLACE_SHOPEE || row.GetName() != "A" {
		t.Fatalf("row = %+v", row)
	}
}

// the-channels-tab-searches-filters-and-pages — q reads the name, the link and the description.
func TestSupplierChannelList_SearchAndTypeFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	s := insertSupplier(t, db, sellingA, "Sumber")
	byName := insertChannel(t, db, s.ID, "shopee", "Kain Official")

	byLink := supplier_service_models.SupplierChannel{SupplierID: s.ID, ChannelType: "other", Name: "Website", URI: "https://kain.example"}
	if err := db.Create(&byLink).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	insertChannel(t, db, s.ID, "tiktok", "Benang")

	got, err := channelList(t, svc, &supplierv1.SupplierChannelListFilter{SupplierId: s.ID, Q: "kain"})
	if err != nil {
		t.Fatalf("q: %v", err)
	}

	if !slices.Equal(got.GetIds(), []uint64{byLink.ID, byName.ID}) {
		t.Fatalf("q=kain ids = %v, want [%d %d]", got.GetIds(), byLink.ID, byName.ID)
	}

	got, err = channelList(t, svc, &supplierv1.SupplierChannelListFilter{
		SupplierId: s.ID, ChannelType: marketplacev1.Marketplace_MARKETPLACE_OTHER,
	})
	if err != nil {
		t.Fatalf("type: %v", err)
	}

	if !slices.Equal(got.GetIds(), []uint64{byLink.ID}) {
		t.Fatalf("type=other ids = %v, want [%d]", got.GetIds(), byLink.ID)
	}
}

func TestSupplierChannelList_DeletedSupplierIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	gone := insertSupplier(t, db, sellingA, "Gone")
	insertChannel(t, db, gone.ID, "shopee", "Store")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)

	_, err := channelList(t, svc, &supplierv1.SupplierChannelListFilter{SupplierId: gone.ID})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("stores of a deleted supplier = %v, want NotFound", connect.CodeOf(err))
	}
}

// chipWarehouse1/2/3 are the Gudang terkait chips of the warehouse tests — 3 never received the supplier's goods.
const (
	chipWarehouse1 uint64 = 9_600_001
	chipWarehouse2 uint64 = 9_600_002
	chipWarehouse3 uint64 = 9_600_003
)

// THE GUDANG TERKAIT CHIP NARROWS THE TOKO TAB (a-supplier-page-is-scoped-by-its-warehouses): only the stores whose goods
// were received at the chip's warehouse, asked of inventory ONCE before the count and the page. Store A's goods are at
// both warehouses, B's only at 1, C's only at 2, D's nowhere: no chip lists all four; chip 1 A and B; chip 2 A and C;
// a warehouse with none of them, nothing. Another team reading the supplier on Discover gets the same stores.
func TestSupplierChannelList_TheWarehouseChipKeepsItsStores(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{}
	svc := supplier_v1.NewService(db, nil, nil, goods, nil, nil)

	sumber := insertSupplier(t, db, sellingA, "PT Sumber Makmur")
	a := insertChannel(t, db, sumber.ID, "shopee", "Toko A")
	b := insertChannel(t, db, sumber.ID, "tokopedia", "Toko B")
	c := insertChannel(t, db, sumber.ID, "tiktok", "Toko C")
	d := insertChannel(t, db, sumber.ID, "lazada", "Toko D")

	goods.storesAt = map[uint64][]uint64{chipWarehouse1: {a.ID, b.ID}, chipWarehouse2: {a.ID, c.ID}}

	list := func(caller, warehouse uint64, limit uint32) ([]uint64, uint64) {
		t.Helper()

		resp, err := svc.SupplierChannelList(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelListRequest{
			TeamId: caller, Filter: &supplierv1.SupplierChannelListFilter{SupplierId: sumber.ID, WarehouseId: warehouse},
			Page: page(1, limit),
		}))
		if err != nil {
			t.Fatalf("SupplierChannelList(warehouse %d): %v", warehouse, err)
		}

		return resp.Msg.GetIds(), resp.Msg.GetPageInfo().GetTotalItems()
	}

	cases := []struct {
		name      string
		warehouse uint64
		want      []uint64
	}{
		{"no chip — every store", 0, []uint64{d.ID, c.ID, b.ID, a.ID}},
		{"warehouse 1 — A (at both) and B", chipWarehouse1, []uint64{b.ID, a.ID}},
		{"warehouse 2 — A (at both) and C", chipWarehouse2, []uint64{c.ID, a.ID}},
		{"warehouse 3 — none of them", chipWarehouse3, nil},
	}

	for _, c := range cases {
		goods.chipAsked = nil

		ids, total := list(sellingA, c.warehouse, 50)
		if !slices.Equal(ids, c.want) || total != uint64(len(c.want)) {
			t.Fatalf("%s = %v of %d, want %v", c.name, ids, total, c.want)
		}

		if c.warehouse == 0 && len(goods.chipAsked) != 0 {
			t.Fatalf("%s asked inventory %v — no chip asks nothing", c.name, goods.chipAsked)
		}

		if c.warehouse != 0 && !slices.Equal(goods.chipAsked, []uint64{c.warehouse}) {
			t.Fatalf("%s asked inventory %v — want once, for the chip's warehouse", c.name, goods.chipAsked)
		}

		// The same stores for another team reading it on Discover.
		theirs, _ := list(sellingB, c.warehouse, 50)
		if !slices.Equal(theirs, ids) {
			t.Fatalf("%s: team B reads %v, team A %v — every team reads the same", c.name, theirs, ids)
		}
	}

	// Narrowed BEFORE the count and the page: one store a page, two pages under chip 1.
	ids, total := list(sellingA, chipWarehouse1, 1)
	if !slices.Equal(ids, []uint64{b.ID}) || total != 2 {
		t.Fatalf("chip 1, one a page = %v of %d, want [%d] of 2", ids, total, b.ID)
	}
}

// The chip and the tab's own filters together; a store the chip keeps but the search misses is gone, a deleted store
// never comes back through the chip.
func TestSupplierChannelList_TheChipWithTheSearchAndTheType(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{}
	svc := supplier_v1.NewService(db, nil, nil, goods, nil, nil)

	sumber := insertSupplier(t, db, sellingA, "PT Sumber Makmur")
	kain := insertChannel(t, db, sumber.ID, "shopee", "Kain Official")
	benang := insertChannel(t, db, sumber.ID, "shopee", "Benang Official")
	closed := insertChannel(t, db, sumber.ID, "tokopedia", "Kain Tutup")
	softDelete(t, db, &supplier_service_models.SupplierChannel{}, closed.ID)

	goods.storesAt = map[uint64][]uint64{chipWarehouse1: {kain.ID, benang.ID, closed.ID}}

	got, err := channelList(t, svc, &supplierv1.SupplierChannelListFilter{SupplierId: sumber.ID, WarehouseId: chipWarehouse1, Q: "kain"})
	if err != nil {
		t.Fatal(err)
	}

	if !slices.Equal(got.GetIds(), []uint64{kain.ID}) {
		t.Fatalf("chip 1 + q=kain = %v, want [%d] — the deleted store stays gone", got.GetIds(), kain.ID)
	}

	got, err = channelList(t, svc, &supplierv1.SupplierChannelListFilter{
		SupplierId: sumber.ID, WarehouseId: chipWarehouse1, ChannelType: marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA,
	})
	if err != nil {
		t.Fatal(err)
	}

	if len(got.GetIds()) != 0 || got.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("chip 1 + Tokopedia = %v — its one Tokopedia store is deleted", got.GetIds())
	}
}

// A warehouse may read a store list (a restock line names its store) but name only its OWN building as the chip — where a
// supplier's goods went is the selling side's to read; inventory that cannot answer is an error, never an empty tab.
func TestSupplierChannelList_TheChipsRefusals(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{storesAt: map[uint64][]uint64{}}
	svc := supplier_v1.NewService(db, nil, nil, goods, nil, nil)

	sumber := insertSupplier(t, db, sellingA, "PT Sumber Makmur")
	store := insertChannel(t, db, sumber.ID, "shopee", "Toko A")
	goods.storesAt[chipWarehouse1] = []uint64{store.ID}

	ask := func(svc *supplier_v1.Service, role role_basev1.Role, caller, warehouse uint64) error {
		ctx := san_auth.WithCallerRole(context.Background(), role)

		_, err := svc.SupplierChannelList(ctx, connect.NewRequest(&supplierv1.SupplierChannelListRequest{
			TeamId: caller, Filter: &supplierv1.SupplierChannelListFilter{SupplierId: sumber.ID, WarehouseId: warehouse},
			Page: page(1, 10),
		}))

		return err
	}

	err := ask(svc, role_basev1.Role_ROLE_WAREHOUSE_STAFF, chipWarehouse2, chipWarehouse1)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a warehouse naming another building: err = %v, want PermissionDenied", err)
	}

	for _, c := range []struct {
		role      role_basev1.Role
		caller    uint64
		warehouse uint64
	}{
		{role_basev1.Role_ROLE_WAREHOUSE_OWNER, chipWarehouse1, chipWarehouse1}, // its own building
		{role_basev1.Role_ROLE_WAREHOUSE_ADMIN, chipWarehouse2, 0},              // no chip
		{role_basev1.Role_ROLE_SELLING_CS, sellingA, chipWarehouse1},            // the selling side, any warehouse
	} {
		err = ask(svc, c.role, c.caller, c.warehouse)
		if err != nil {
			t.Fatalf("%v in team %d, warehouse %d: %v", c.role, c.caller, c.warehouse, err)
		}
	}

	goods.err = errors.New("down")

	err = ask(svc, role_basev1.Role_ROLE_SELLING_OWNER, sellingA, chipWarehouse1)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("inventory down under a chip: err = %v, want Internal", err)
	}

	// A service built without inventory answers no chip — an error, never an empty tab; with no chip it still lists.
	bare := supplier_v1.NewService(db, nil, nil, nil, nil, nil)

	err = ask(bare, role_basev1.Role_ROLE_SELLING_OWNER, sellingA, chipWarehouse1)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("no inventory under a chip: err = %v, want Internal", err)
	}

	err = ask(bare, role_basev1.Role_ROLE_SELLING_OWNER, sellingA, 0)
	if err != nil {
		t.Fatalf("no inventory, no chip: %v", err)
	}
}
