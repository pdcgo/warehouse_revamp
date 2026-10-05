package team_v1

import (
	"testing"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
)

// ownerRoleFor keeps its role numbers as raw ints, so this pins them to the generated enum: a number
// that drifts from its name would grant the wrong role to every new team of that type.
func TestOwnerRoleFor_EachTeamTypeHasItsOwnOwner(t *testing.T) {
	cases := []struct {
		teamType teamv1.TeamType
		want     role_basev1.Role
	}{
		{teamv1.TeamType_TEAM_TYPE_WAREHOUSE, role_basev1.Role_ROLE_WAREHOUSE_OWNER},
		{teamv1.TeamType_TEAM_TYPE_SELLING, role_basev1.Role_ROLE_SELLING_OWNER},
		// the-admin-team-roles-are-added-first — no longer the selling Owner.
		{teamv1.TeamType_TEAM_TYPE_ADMIN, role_basev1.Role_ROLE_ADMIN_OWNER},
	}

	for _, c := range cases {
		got := role_basev1.Role(ownerRoleFor(c.teamType))
		if got != c.want {
			t.Errorf("ownerRoleFor(%s) = %s, want %s", c.teamType, got, c.want)
		}
	}
}
