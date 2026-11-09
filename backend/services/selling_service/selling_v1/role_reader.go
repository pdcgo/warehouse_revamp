package selling_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

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

	// Member is the person's place in the team as a GRANT needs it: their role there (UNSPECIFIED = not a member) and
	// whether the account is suspended — an erased account is always suspended too. A grant goes only to a member
	// (a-grant-goes-only-to-a-team-member), and never to a suspended account (a-suspended-user-is-never-picked).
	Member(ctx context.Context, userID, teamID uint64) (TeamMember, error)
}

// TeamMember is one person's place in one team, in this service's terms.
type TeamMember struct {
	Role      role_basev1.Role
	Suspended bool
}

// noRoles knows no roles, so only a grant opens a shop, and nobody can be granted one — the default that fails closed.
type noRoles struct{}

func (noRoles) Roles(context.Context, uint64, uint64) (role_basev1.Role, role_basev1.Role, error) {
	return role_basev1.Role_ROLE_UNSPECIFIED, role_basev1.Role_ROLE_UNSPECIFIED, nil
}

func (noRoles) Member(context.Context, uint64, uint64) (TeamMember, error) {
	return TeamMember{}, nil
}

var (
	errGrantNotMember = errors.New("is not a member of this shop's team — add them to the team first (a-grant-goes-only-to-a-team-member)")
	errGrantSuspended = errors.New("is suspended — a suspended account is never given a shop (a-suspended-user-is-never-picked)")
)

// refuseUngrantable is the rule for whoever is GIVEN something on a shop — a new grant, or Make primary: a member of the
// shop's team, and not suspended. Asked before the write's transaction: membership is user_service's, read through the
// same cached resolver every request already pays for, never a join on its tables. The person is refused by id, since
// this service knows no names.
func (s *Service) refuseUngrantable(ctx context.Context, teamID, userID uint64) error {
	member, err := s.roles.Member(ctx, userID, teamID)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	if member.Role == role_basev1.Role_ROLE_UNSPECIFIED {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("user %d %w", userID, errGrantNotMember))
	}

	if member.Suspended {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("user %d %w", userID, errGrantSuspended))
	}

	return nil
}

// isManager reports whether a role writes on every shop of its team without a grant.
func isManager(team, root role_basev1.Role) bool {
	switch root {
	case role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR:
		return true
	}

	switch team {
	case role_basev1.Role_ROLE_SELLING_OWNER, role_basev1.Role_ROLE_SELLING_ADMIN:
		return true
	}

	return false
}
