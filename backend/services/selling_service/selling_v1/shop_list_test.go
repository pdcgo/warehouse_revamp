package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestShopList_ScopedAndSearchable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertShop(t, db, 2, "Alpha Store", "A1", "shopee")
	insertShop(t, db, 2, "Beta Store", "B1", "tokopedia")
	insertShop(t, db, 3, "Other Team Shop", "C1", "lazada") // different team — must not appear

	// Team 2 sees only its own two shops.
	resp, err := svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ShopList: %v", err)
	}
	if len(shopRows(resp.Msg)) != 2 {
		t.Fatalf("team 2 shops = %d, want 2", len(shopRows(resp.Msg)))
	}

	// `q` filters by name or code.
	resp, err = svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: 2, Filter: &sellingv1.ShopListFilter{Q: "alpha"}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ShopList (q): %v", err)
	}
	if len(shopRows(resp.Msg)) != 1 || shopRows(resp.Msg)[0].GetName() != "Alpha Store" {
		t.Fatalf("search result = %+v", shopRows(resp.Msg))
	}
}
