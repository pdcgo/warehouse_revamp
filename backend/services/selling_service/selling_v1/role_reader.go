package selling_v1

import (
	"context"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
)

// RoleReader answers a user's role in a team, and in the root team.
//
// ShopAccessCheck needs it because a MANAGER writes on any shop of the team without a grant — the
// team's owner or admin, and root or admin (a-write-needs-a-grant-or-a-manager). Roles are
// user_service's, so this service declares the question in its own terms and the composition root
// answers it with the access interceptor's cached resolver — the same lookup every request already
// pays for.
type RoleReader interface {
	Roles(ctx context.Context, userID, teamID uint64) (team role_basev1.Role, root role_basev1.Role, err error)
}

// noRoles knows no roles, so only a grant opens a shop — the default that fails closed.
type noRoles struct{}

func (noRoles) Roles(context.Context, uint64, uint64) (role_basev1.Role, role_basev1.Role, error) {
	return role_basev1.Role_ROLE_UNSPECIFIED, role_basev1.Role_ROLE_UNSPECIFIED, nil
}

// isManager reports whether a role writes on every shop of its team without a grant.
func isManager(team, root role_basev1.Role) bool {
	switch root {
	case role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMIN:
		return true
	}

	switch team {
	case role_basev1.Role_ROLE_TEAM_OWNER, role_basev1.Role_ROLE_TEAM_ADMIN:
		return true
	}

	return false
}
