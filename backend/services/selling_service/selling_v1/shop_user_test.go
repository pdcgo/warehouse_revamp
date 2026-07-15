package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func listUsers(t *testing.T, svc interface {
	ShopUserList(context.Context, *connect.Request[sellingv1.ShopUserListRequest]) (*connect.Response[sellingv1.ShopUserListResponse], error)
}, teamID, shopID uint64) []uint64 {
	t.Helper()

	resp, err := svc.ShopUserList(context.Background(), connect.NewRequest(&sellingv1.ShopUserListRequest{
		TeamId: teamID, ShopId: shopID, Page: &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ShopUserList: %v", err)
	}

	return resp.Msg.GetUserIds()
}

func TestShopUser_AddListRemove(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")

	for _, uid := range []uint64{10, 11} {
		_, err := svc.ShopUserAdd(ctx, connect.NewRequest(&sellingv1.ShopUserAddRequest{
			TeamId: 2, ShopId: shopID, UserId: uid,
		}))
		if err != nil {
			t.Fatalf("ShopUserAdd %d: %v", uid, err)
		}
	}

	// Idempotent: adding an existing grant is a no-op success.
	_, err := svc.ShopUserAdd(ctx, connect.NewRequest(&sellingv1.ShopUserAddRequest{TeamId: 2, ShopId: shopID, UserId: 10}))
	if err != nil {
		t.Fatalf("re-add: %v", err)
	}

	if got := listUsers(t, svc, 2, shopID); len(got) != 2 {
		t.Fatalf("users = %v, want 2", got)
	}

	// Remove one; the other stays.
	_, err = svc.ShopUserRemove(ctx, connect.NewRequest(&sellingv1.ShopUserRemoveRequest{TeamId: 2, ShopId: shopID, UserId: 10}))
	if err != nil {
		t.Fatalf("ShopUserRemove: %v", err)
	}

	got := listUsers(t, svc, 2, shopID)
	if len(got) != 1 || got[0] != 11 {
		t.Fatalf("after remove: %v, want [11]", got)
	}
}

// A shop belongs to team 2; team 3 must not touch its access list.
func TestShopUser_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "S2", "shopee")

	_, err := svc.ShopUserAdd(ctx, connect.NewRequest(&sellingv1.ShopUserAddRequest{TeamId: 3, ShopId: shopID, UserId: 10}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team add code = %v, want NotFound", connect.CodeOf(err))
	}

	_, err = svc.ShopUserList(ctx, connect.NewRequest(&sellingv1.ShopUserListRequest{
		TeamId: 3, ShopId: shopID, Page: &commonv1.PageFilter{Page: 1, Limit: 50},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team list code = %v, want NotFound", connect.CodeOf(err))
	}
}
