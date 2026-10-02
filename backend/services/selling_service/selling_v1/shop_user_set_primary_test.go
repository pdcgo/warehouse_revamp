package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func grant(t *testing.T, svc *selling_v1.Service, teamID, shopID, userID uint64) {
	t.Helper()

	_, err := svc.ShopUserAdd(context.Background(), connect.NewRequest(&sellingv1.ShopUserAddRequest{
		TeamId: teamID, ShopId: shopID, UserId: userID,
	}))
	if err != nil {
		t.Fatalf("ShopUserAdd %d: %v", userID, err)
	}
}

func primaryOf(t *testing.T, svc *selling_v1.Service, teamID, shopID uint64) uint64 {
	t.Helper()

	resp, err := svc.ShopDetail(context.Background(), connect.NewRequest(&sellingv1.ShopDetailRequest{
		TeamId: teamID, ShopId: shopID,
	}))
	if err != nil {
		t.Fatalf("ShopDetail: %v", err)
	}

	return resp.Msg.GetShop().GetPrimaryUserId()
}

// the-primary-cs-is-a-flag-on-a-grant, end to end: the first grant becomes it, Make primary moves it,
// and removing its grant leaves the shop with none until the next grant.
func TestShopUserSetPrimary_TheFirstGrantThenMakePrimaryThenNone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Melati", "M1", "shopee")

	grant(t, svc, 2, shopID, 10)
	grant(t, svc, 2, shopID, 11)

	if got := primaryOf(t, svc, 2, shopID); got != 10 {
		t.Fatalf("after two grants: primary = %d, want 10 — the FIRST grant", got)
	}

	resp, err := svc.ShopUserSetPrimary(ctx, connect.NewRequest(&sellingv1.ShopUserSetPrimaryRequest{
		TeamId: 2, ShopId: shopID, UserId: 11,
	}))
	if err != nil {
		t.Fatalf("ShopUserSetPrimary: %v", err)
	}

	if resp.Msg.GetShop().GetPrimaryUserId() != 11 {
		t.Errorf("the answer's primary = %d, want 11", resp.Msg.GetShop().GetPrimaryUserId())
	}

	if got := primaryOf(t, svc, 2, shopID); got != 11 {
		t.Fatalf("after Make primary: primary = %d, want 11", got)
	}

	// Idempotent.
	_, err = svc.ShopUserSetPrimary(ctx, connect.NewRequest(&sellingv1.ShopUserSetPrimaryRequest{
		TeamId: 2, ShopId: shopID, UserId: 11,
	}))
	if err != nil {
		t.Fatalf("Make primary again: %v", err)
	}

	// Removing the primary's grant takes the flag with it — nothing picks a successor.
	_, err = svc.ShopUserRemove(ctx, connect.NewRequest(&sellingv1.ShopUserRemoveRequest{
		TeamId: 2, ShopId: shopID, UserId: 11,
	}))
	if err != nil {
		t.Fatalf("ShopUserRemove: %v", err)
	}

	if got := primaryOf(t, svc, 2, shopID); got != 0 {
		t.Fatalf("after removing the primary's grant: primary = %d, want 0 — user 10 must NOT be promoted", got)
	}

	// Re-adding an existing grant is a no-op, flag included.
	grant(t, svc, 2, shopID, 10)

	if got := primaryOf(t, svc, 2, shopID); got != 0 {
		t.Fatalf("re-adding an existing grant made it primary = %d", got)
	}

	// The next NEW grant finds none, and becomes it.
	grant(t, svc, 2, shopID, 12)

	if got := primaryOf(t, svc, 2, shopID); got != 12 {
		t.Fatalf("the next new grant: primary = %d, want 12", got)
	}
}

// A primary is never someone without a grant.
func TestShopUserSetPrimary_RefusesAUserWithNoGrant(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopID := insertShop(t, db, 2, "Melati", "M1", "shopee")
	grant(t, svc, 2, shopID, 10)

	_, err := svc.ShopUserSetPrimary(context.Background(), connect.NewRequest(&sellingv1.ShopUserSetPrimaryRequest{
		TeamId: 2, ShopId: shopID, UserId: 99,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if got := primaryOf(t, svc, 2, shopID); got != 10 {
		t.Fatalf("a refused Make primary moved the primary to %d", got)
	}
}

func TestShopUserSetPrimary_AnotherTeamsShopIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopID := insertShop(t, db, 3, "Other", "O1", "shopee")
	grant(t, svc, 3, shopID, 10)

	_, err := svc.ShopUserSetPrimary(context.Background(), connect.NewRequest(&sellingv1.ShopUserSetPrimaryRequest{
		TeamId: 2, ShopId: shopID, UserId: 10,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// The list carries each shop's primary too — the /shops warning badge reads it.
func TestShopList_CarriesThePrimary(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	withPrimary := insertShop(t, db, 2, "Melati", "M1", "shopee")
	withNone := insertShop(t, db, 2, "Mawar", "M2", "tiktok")
	grant(t, svc, 2, withPrimary, 10)

	resp, err := svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: 2,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ShopList: %v", err)
	}

	shops := resp.Msg.GetItems()[0].GetShop().GetMapData()
	if shops[withPrimary].GetPrimaryUserId() != 10 {
		t.Errorf("shop %d primary = %d, want 10", withPrimary, shops[withPrimary].GetPrimaryUserId())
	}

	if shops[withNone].GetPrimaryUserId() != 0 {
		t.Errorf("shop %d primary = %d, want 0", withNone, shops[withNone].GetPrimaryUserId())
	}
}
