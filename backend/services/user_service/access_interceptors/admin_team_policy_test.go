package access_interceptors

import (
	"sort"
	"strings"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	// Every request message must be LINKED for the registry walk below to see it — an unlinked
	// package's policies would silently go unchecked.
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// The admin team's two roles manage their own team and nothing else
// (admin-team-roles-manage-only-their-team): both edit the team's info and read its members, and only
// the Owner manages them (the-admin-team-admin-alone-does-not-manage-members).
//
// The test is over the WHOLE contract, not the six messages: the failure it exists to catch is an admin
// role added to a selling or warehouse policy, which a per-message test would never look at.
func TestAdminTeamRoles_HoldOnlyTheirOwnTeamsPolicies(t *testing.T) {
	want := map[role_basev1.Role][]string{
		role_basev1.Role_ROLE_ADMIN_OWNER: {
			"warehouse.team.v1.TeamInfoUpdateRequest",
			"warehouse.team.v1.TeamUpdateRequest",
			"warehouse.user.v1.CreateUserRequest",
			"warehouse.user.v1.TeamMemberLogListRequest",
			"warehouse.user.v1.TeamUserUpdateRequest",
			"warehouse.user.v1.UserListRequest",
		},
		role_basev1.Role_ROLE_ADMIN_ADMINISTRATOR: {
			"warehouse.team.v1.TeamInfoUpdateRequest",
			"warehouse.team.v1.TeamUpdateRequest",
			"warehouse.user.v1.TeamMemberLogListRequest",
			"warehouse.user.v1.UserListRequest",
		},
	}

	got := map[role_basev1.Role][]string{}
	seen := 0

	protoregistry.GlobalFiles.RangeFiles(func(file protoreflect.FileDescriptor) bool {
		if !strings.HasPrefix(string(file.Package()), "warehouse.") {
			return true
		}

		messages := file.Messages()
		for i := 0; i < messages.Len(); i++ {
			message := messages.Get(i)

			policy := san_auth.PolicyOf(message)
			if policy == nil {
				continue
			}

			seen++

			for _, role := range policy.GetRoles() {
				if _, tracked := want[role]; tracked {
					got[role] = append(got[role], string(message.FullName()))
				}
			}
		}

		return true
	})

	// A walk that found nothing would pass vacuously.
	if seen < 100 {
		t.Fatalf("only %d request policies found — a generated package is not linked", seen)
	}

	for role, names := range want {
		have := got[role]
		sort.Strings(have)

		if strings.Join(have, ",") != strings.Join(names, ",") {
			t.Errorf("%s is held by\n  %v\nwant exactly\n  %v", role, have, names)
		}
	}
}
