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
