package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// fakeRoles stands in for user_service's resolver: a role per (user, team). The root team is
// san_auth.RootTeamID, as in the real one.
type fakeRoles map[[2]uint64]role_basev1.Role

func (f fakeRoles) Roles(_ context.Context, userID, teamID uint64) (role_basev1.Role, role_basev1.Role, error) {
	return f[[2]uint64{userID, teamID}], f[[2]uint64{userID, san_auth.RootTeamID}], nil
}

func newServiceWithRoles(t *testing.T, db *gorm.DB, roles selling_v1.RoleReader) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, nil, roles)
}

func accessCheck(t *testing.T, svc *selling_v1.Service, teamID, shopID, userID uint64) *sellingv1.ShopAccessCheckResponse {
	t.Helper()

	resp, err := svc.ShopAccessCheck(context.Background(), connect.NewRequest(&sellingv1.ShopAccessCheckRequest{
		TeamId: teamID, ShopId: shopID, UserId: userID,
	}))
	if err != nil {
		t.Fatalf("ShopAccessCheck(user %d): %v", userID, err)
	}

	return resp.Msg
}

// a-write-needs-a-grant-or-a-manager, as is_have_access computes it: a grant, or the team's owner or
// admin, or root or admin — and a plain CS without a grant is refused.
func TestShopAccessCheck_AGrantOrAManagerHasAccess(t *testing.T) {
	db := san_testdb.DB(t)

	const (
		team      = 2
		granted   = 10
		cs        = 11
		owner     = 12
		teamAdmin = 13
		root      = 14
	)

	svc := newServiceWithRoles(t, db, fakeRoles{
		{granted, team}:              role_basev1.Role_ROLE_TEAM_CUSTOMER_SERVICE,
		{cs, team}:                   role_basev1.Role_ROLE_TEAM_CUSTOMER_SERVICE,
		{owner, team}:                role_basev1.Role_ROLE_TEAM_OWNER,
		{teamAdmin, team}:            role_basev1.Role_ROLE_TEAM_ADMIN,
		{root, san_auth.RootTeamID}:  role_basev1.Role_ROLE_ROOT,
	})
	shopID := insertShop(t, db, team, "Melati", "M1", "shopee")

	_, err := svc.ShopUserAdd(context.Background(), connect.NewRequest(&sellingv1.ShopUserAddRequest{
		TeamId: team, ShopId: shopID, UserId: granted,
	}))
	if err != nil {
		t.Fatalf("ShopUserAdd: %v", err)
	}

	for _, tc := range []struct {
		name string
		user uint64
		want bool
	}{
		{"a granted CS", granted, true},
		{"a CS with no grant", cs, false},
		{"the team's owner, no grant", owner, true},
		{"the team's admin, no grant", teamAdmin, true},
		{"root, no grant", root, true},
		{"someone with no role at all", 99, false},
	} {
		got := accessCheck(t, svc, team, shopID, tc.user)
		if got.GetIsHaveAccess() != tc.want {
			t.Errorf("%s: is_have_access = %v, want %v", tc.name, got.GetIsHaveAccess(), tc.want)
		}

		if got.GetShop().GetId() != shopID {
			t.Errorf("%s: shop = %d, want %d", tc.name, got.GetShop().GetId(), shopID)
		}

		// The first grant is the primary (the-primary-cs-is-a-flag-on-a-grant), whoever asks.
		if got.GetPrimaryUserId() != granted || got.GetShop().GetPrimaryUserId() != granted {
			t.Errorf("%s: primary = %d / %d, want %d", tc.name, got.GetPrimaryUserId(), got.GetShop().GetPrimaryUserId(), granted)
		}
	}
}

// A shop nobody has been granted has no primary — the importer refuses it on that
// (a-shop-with-no-primary-cs-cannot-import).
func TestShopAccessCheck_AShopWithNoGrantHasNoPrimary(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithRoles(t, db, fakeRoles{{12, 2}: role_basev1.Role_ROLE_TEAM_OWNER})
	shopID := insertShop(t, db, 2, "Melati", "M1", "tiktok")

	got := accessCheck(t, svc, 2, shopID, 12)
	if got.GetPrimaryUserId() != 0 {
		t.Errorf("primary = %d, want 0", got.GetPrimaryUserId())
	}

	if !got.GetIsHaveAccess() {
		t.Error("the owner should have access without a grant")
	}
}

// Another team's shop, and a deleted one, are not found — the scope check, and delete hiding a shop
// from every read.
func TestShopAccessCheck_AnotherTeamsOrADeletedShopIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithRoles(t, db, nil)
	ctx := context.Background()

	foreign := insertShop(t, db, 3, "Other", "O1", "shopee")
	deleted := insertShop(t, db, 2, "Gone", "G1", "shopee")

	_, err := svc.ShopDelete(ctx, connect.NewRequest(&sellingv1.ShopDeleteRequest{TeamId: 2, ShopId: deleted}))
	if err != nil {
		t.Fatalf("ShopDelete: %v", err)
	}

	for name, shopID := range map[string]uint64{"another team's shop": foreign, "a deleted shop": deleted} {
		_, err := svc.ShopAccessCheck(ctx, connect.NewRequest(&sellingv1.ShopAccessCheckRequest{
			TeamId: 2, ShopId: shopID, UserId: 10,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s: code = %v, want NotFound", name, connect.CodeOf(err))
		}
	}
}
