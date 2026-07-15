package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestShopDelete_SoftDeletesAndDropsFromList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Doomed", "DEL", "shopee")

	_, err := svc.ShopDelete(context.Background(), connect.NewRequest(&sellingv1.ShopDeleteRequest{
		TeamId: 2, ShopId: id,
	}))
	if err != nil {
		t.Fatalf("ShopDelete: %v", err)
	}

	// Gone from the list (ShopList excludes deleted = true).
	resp, err := svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ShopList: %v", err)
	}
	if len(resp.Msg.GetShops()) != 0 {
		t.Fatalf("deleted shop still listed: %+v", resp.Msg.GetShops())
	}
}

// A shop belongs to team 2; team 3 must not delete it via its own scope.
func TestShopDelete_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Team 2 shop", "S3", "shopee")

	_, err := svc.ShopDelete(context.Background(), connect.NewRequest(&sellingv1.ShopDeleteRequest{
		TeamId: 3, ShopId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team delete code = %v, want NotFound", connect.CodeOf(err))
	}
}
