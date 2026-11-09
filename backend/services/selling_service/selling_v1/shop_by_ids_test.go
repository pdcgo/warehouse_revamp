package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// SHOPS ACROSS TEAMS, BASIC FIELDS (the-warehouse-row-fills-from-shop-and-user-by-ids): two teams' shops in one call,
// a closed shop still named, an unknown id absent.
func TestShopByIds_AcrossTeamsBasicOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melati := insertShop(t, db, 2, "Melati Official", "MEL-S", "shopee")
	kenanga := insertShop(t, db, 3, "Kenanga Official", "KEN-T", "tiktok")
	closed := insertShop(t, db, 2, "Melati Lama", "MEL-OLD", "tokopedia")

	_, err := svc.ShopClose(context.Background(), connect.NewRequest(&sellingv1.ShopCloseRequest{TeamId: 2, ShopId: closed}))
	if err != nil {
		t.Fatalf("close the shop: %v", err)
	}

	res, err := svc.ShopByIds(context.Background(), connect.NewRequest(&sellingv1.ShopByIdsRequest{
		Filter: &sellingv1.ShopByIdsFilter{Ids: []uint64{melati, kenanga, closed, 999_999}},
	}))
	if err != nil {
		t.Fatalf("ShopByIds: %v", err)
	}

	items := res.Msg.GetItems()

	if _, ok := items[999_999]; ok {
		t.Fatalf("an id that never existed is answered")
	}

	want := map[uint64]struct {
		team        uint64
		name        string
		marketplace marketplacev1.Marketplace
	}{
		melati:  {2, "Melati Official", marketplacev1.Marketplace_MARKETPLACE_SHOPEE},
		kenanga: {3, "Kenanga Official", marketplacev1.Marketplace_MARKETPLACE_TIKTOK},
		// Closed, and still named — an old order still names its shop.
		closed: {2, "Melati Lama", marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA},
	}

	for id, w := range want {
		list := items[id].GetItems()
		if len(list) != 1 {
			t.Fatalf("shop %d: %d slices, want the one BASIC slice by default", id, len(list))
		}

		got := list[0].GetBasic().GetMapData()[id]
		if got.GetTeamId() != w.team || got.GetName() != w.name || got.GetMarketplace() != w.marketplace {
			t.Fatalf("shop %d = %+v, want team %d %q %v", id, got, w.team, w.name, w.marketplace)
		}
	}
}

// The GENERAL slice, when asked for, is the id and the name.
func TestShopByIds_GeneralSlice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melati := insertShop(t, db, 2, "Melati Official", "MEL-S", "shopee")

	res, err := svc.ShopByIds(context.Background(), connect.NewRequest(&sellingv1.ShopByIdsRequest{
		Filter:      &sellingv1.ShopByIdsFilter{Ids: []uint64{melati}},
		DataRequest: []sellingv1.ShopByIdsDataType{sellingv1.ShopByIdsDataType_SHOP_BY_IDS_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		t.Fatalf("ShopByIds: %v", err)
	}

	list := res.Msg.GetItems()[melati].GetItems()
	if len(list) != 1 || list[0].GetGeneral().GetMapData()[melati].GetName() != "Melati Official" {
		t.Fatalf("general slice = %+v", list)
	}
}
