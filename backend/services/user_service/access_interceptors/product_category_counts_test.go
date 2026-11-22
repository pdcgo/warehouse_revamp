package access_interceptors

import (
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// THE KATEGORI PAGE'S PRODUCT COUNT (ProductCategoryCounts) is Root's and the Administrator's alone, as the page is —
// run through the REAL interceptor for every role there is: Root and the Administrator in the root team reach the
// handler; every other role is refused PermissionDenied before it, whether held in the root team, in a selling or
// warehouse team, or as the admin team's monitor (an unscoped read names no team a monitor could look into).
func TestProductCategoryCounts_RootAndTheAdministratorAlone(t *testing.T) {
	const otherTeam = uint64(5)

	allowed := map[role_basev1.Role]bool{
		role_basev1.Role_ROLE_ROOT:          true,
		role_basev1.Role_ROLE_ADMINISTRATOR: true,
	}

	values := role_basev1.Role(0).Descriptor().Values()
	if values.Len() < 10 {
		t.Fatalf("only %d roles found — the enum is not linked", values.Len())
	}

	for i := 0; i < values.Len(); i++ {
		role := role_basev1.Role(values.Get(i).Number())
		if role == role_basev1.Role_ROLE_UNSPECIFIED {
			continue
		}

		for _, team := range []uint64{san_auth.RootTeamID, otherTeam} {
			reached, err := call(t, memberOf(team, role), &productv1.ProductCategoryCountsRequest{}, tokenFor(t, 7))

			if allowed[role] && team == san_auth.RootTeamID {
				if err != nil || !reached {
					t.Errorf("%s in the root team: reached=%v err=%v — want the count answered", role, reached, err)
				}

				continue
			}

			if reached || codeOf(err) != connect.CodePermissionDenied {
				t.Errorf("%s in team %d: reached=%v code=%v — want PermissionDenied before the handler", role, team, reached, codeOf(err))
			}
		}
	}

	// The admin team's monitor: a read, but unscoped — no warehouse or selling team in play, so no monitor pass.
	for _, role := range []role_basev1.Role{role_basev1.Role_ROLE_ADMIN_OWNER, role_basev1.Role_ROLE_ADMIN_ADMINISTRATOR} {
		monitor := stubResolver{adminTeam: role}

		reached, err := call(t, monitor, &productv1.ProductCategoryCountsRequest{}, tokenFor(t, 11))
		if reached || codeOf(err) != connect.CodePermissionDenied {
			t.Errorf("the admin team's %s as a monitor: reached=%v code=%v — want PermissionDenied", role, reached, codeOf(err))
		}
	}
}
