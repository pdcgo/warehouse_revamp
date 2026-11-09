package selling_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// fakeMembers stands in for user_service's resolver as a grant asks it: each (user, team)'s place, absent = not a member.
type fakeMembers map[[2]uint64]selling_v1.TeamMember

func (f fakeMembers) Roles(_ context.Context, userID, teamID uint64) (role_basev1.Role, role_basev1.Role, error) {
	return f[[2]uint64{userID, teamID}].Role, role_basev1.Role_ROLE_UNSPECIFIED, nil
}

func (f fakeMembers) Member(_ context.Context, userID, teamID uint64) (selling_v1.TeamMember, error) {
	return f[[2]uint64{userID, teamID}], nil
}

const (
	grantTeam     uint64 = 2
	grantMember   uint64 = 10
	grantOutsider uint64 = 11 // a member of ANOTHER team only
	grantSuspend  uint64 = 12
)

func grantCast() fakeMembers {
	return fakeMembers{
		{grantMember, grantTeam}:  {Role: role_basev1.Role_ROLE_SELLING_CS},
		{grantOutsider, 3}:        {Role: role_basev1.Role_ROLE_SELLING_CS},
		{grantSuspend, grantTeam}: {Role: role_basev1.Role_ROLE_SELLING_CS, Suspended: true},
	}
}

// a-grant-goes-only-to-a-team-member and a-suspended-user-is-never-picked: a member is granted; someone outside the
// shop's team, and a suspended member, are refused FailedPrecondition by id, and no grant is written for either.
func TestShopUserAdd_OnlyAnActiveMemberOfTheShopsTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithRoles(t, db, grantCast())
	ctx := context.Background()

	shopID := insertShop(t, db, grantTeam, "Melati", "GM1", "shopee")

	_, err := svc.ShopUserAdd(ctx, connect.NewRequest(&sellingv1.ShopUserAddRequest{
		TeamId: grantTeam, ShopId: shopID, UserId: grantMember,
	}))
	if err != nil {
		t.Fatalf("granting a member: %v", err)
	}

	for _, refused := range []struct {
		user uint64
		says string
	}{
		{grantOutsider, "not a member"},
		{grantSuspend, "suspended"},
		{999, "not a member"}, // nobody at all
	} {
		_, err := svc.ShopUserAdd(ctx, connect.NewRequest(&sellingv1.ShopUserAddRequest{
			TeamId: grantTeam, ShopId: shopID, UserId: refused.user,
		}))
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("granting user %d: code = %v, want FailedPrecondition", refused.user, connect.CodeOf(err))
		}

		if !strings.Contains(err.Error(), refused.says) {
			t.Fatalf("granting user %d: %q, want it to say %q", refused.user, err.Error(), refused.says)
		}
	}

	got := listUsers(t, svc, grantTeam, shopID)
	if len(got) != 1 || got[0] != grantMember {
		t.Fatalf("grants = %v, want only [%d]", got, grantMember)
	}
}
