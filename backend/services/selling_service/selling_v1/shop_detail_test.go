package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestShopDetail_Returns(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Detail Shop", "D1", "tiktok")

	resp, err := svc.ShopDetail(context.Background(), connect.NewRequest(&sellingv1.ShopDetailRequest{
		TeamId: 2, ShopId: id,
	}))
	if err != nil {
		t.Fatalf("ShopDetail: %v", err)
	}

	got := resp.Msg.GetShop()
	if got.GetName() != "Detail Shop" || got.GetMarketplace() != marketplacev1.Marketplace_MARKETPLACE_TIKTOK {
		t.Fatalf("unexpected shop: %+v", got)
	}
}

// A shop belongs to team 2; team 3 must not read it via its own scope.
func TestShopDetail_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Team 2 shop", "T2", "shopee")

	_, err := svc.ShopDetail(context.Background(), connect.NewRequest(&sellingv1.ShopDetailRequest{
		TeamId: 3, ShopId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team detail code = %v, want NotFound", connect.CodeOf(err))
	}
}
