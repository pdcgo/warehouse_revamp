package user_v1

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// Who may give, change and take a role (docs/business/user/context_decision.md). The access
// interceptor proves the caller may call the RPC at all; these rules decide what they may do to WHOM.
//
// The frontend shows the same rules (frontend/src/lib/roles.ts), but that is UX. This is the check.

// callerReach is how far the caller reaches in one team: Root and the Administrator through the root
// team, everyone else through the role they hold in the team itself.
type callerReach struct {
	id     uint64
	root   role_basev1.Role
	inTeam role_basev1.Role
}

func (c callerReach) isRoot() bool {
	return c.root == role_basev1.Role_ROLE_ROOT
}

func (c callerReach) isAdministrator() bool {
	return c.root == role_basev1.Role_ROLE_ADMINISTRATOR
}

// memberWrite is one change to a team's membership: the person holding `current` (UNSPECIFIED = not a
// member) is given `next` (UNSPECIFIED = removed).
type memberWrite struct {
	teamType teamv1.TeamType
	target   uint64
	current  role_basev1.Role
	next     role_basev1.Role
}

// teamRoles is each team type's own role set (every-role-has-a-code-name). A role from another team
// type stores a membership that looks like something and grants the wrong thing.
var teamRoles = map[teamv1.TeamType][]role_basev1.Role{
	teamv1.TeamType_TEAM_TYPE_ROOT: {
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
	},
	teamv1.TeamType_TEAM_TYPE_ADMIN: {
		role_basev1.Role_ROLE_ADMIN_OWNER,
		role_basev1.Role_ROLE_ADMIN_ADMINISTRATOR,
	},
	teamv1.TeamType_TEAM_TYPE_WAREHOUSE: {
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	},
	teamv1.TeamType_TEAM_TYPE_SELLING: {
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	},
}

func roleBelongsTo(role role_basev1.Role, teamType teamv1.TeamType) bool {
	for _, r := range teamRoles[teamType] {
		if r == role {
			return true
		}
	}

	return false
}

// roleRank: Owner > Admin > the floor role, inside a team. Root and the Administrator are not ranked
// here — they are checked by name, above every team.
func roleRank(role role_basev1.Role) int {
	switch role {
	case role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_ADMIN_OWNER:
		return 30
	case role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_ADMIN_ADMINISTRATOR:
		return 20
	case role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF:
		return 10
	default:
		return 0
	}
}

// managesMembers — every Owner, the warehouse and selling Admins
// (the-admin-team-admin-alone-does-not-manage-members). The member policies already keep the others
// out; this repeats it so the rule does not depend on a proto edit staying correct.
func managesMembers(role role_basev1.Role) bool {
	switch role {
	case role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_ADMIN_OWNER:
		return true
	default:
		return false
	}
}

func refuse(decision, what string) error {
	return connect.NewError(connect.CodePermissionDenied, fmt.Errorf("%s (%s)", what, decision))
}

// checkMemberWrite decides one membership change. It reads nothing, so every rule is testable alone.
func checkMemberWrite(caller callerReach, w memberWrite) error {
	if w.next == role_basev1.Role_ROLE_ROOT {
		return refuse("root-is-granted-only-through-san", "Root is never given from the app")
	}

	if w.current == role_basev1.Role_ROLE_ROOT {
		return refuse("root-is-granted-only-through-san", "a Root's membership changes only through san")
	}

	if w.next != role_basev1.Role_ROLE_UNSPECIFIED && !roleBelongsTo(w.next, w.teamType) {
		return connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("%s is not a role of a %s team (every-role-has-a-code-name)", w.next, w.teamType))
	}

	// Nobody changes or removes their own membership. Adding yourself to a team you are not in is
	// left to Root and the Administrator below — TeamCreate no longer adds the creator
	// (the-create-team-form-names-the-first-owner), but the form may still name them as the Owner, and
	// no decision refuses that.
	if w.target == caller.id && w.current != role_basev1.Role_ROLE_UNSPECIFIED {
		return refuse("change-role-only-below-your-own", "nobody changes their own membership")
	}

	if caller.isRoot() {
		return nil
	}

	if caller.isAdministrator() {
		if w.next == role_basev1.Role_ROLE_ADMINISTRATOR || w.current == role_basev1.Role_ROLE_ADMINISTRATOR {
			return refuse("root-grants-the-administrator", "only Root gives or takes the Administrator")
		}

		return nil
	}

	// A team-level caller: an Owner, or a warehouse or selling Admin.
	if w.target == caller.id {
		return refuse("change-role-only-below-your-own", "nobody changes their own membership")
	}

	if !managesMembers(caller.inTeam) {
		return refuse("the-admin-team-admin-alone-does-not-manage-members", "you do not manage this team's members")
	}

	if w.current != role_basev1.Role_ROLE_UNSPECIFIED && roleRank(w.current) >= roleRank(caller.inTeam) {
		return refuse("change-role-only-below-your-own", "only a member below your own role")
	}

	// An Owner never makes another Owner, an Admin never another Admin, and nobody gives a role at or
	// above their own (an-owner-never-makes-another-owner, no-admin-makes-another-admin).
	if w.next != role_basev1.Role_ROLE_UNSPECIFIED && roleRank(w.next) >= roleRank(caller.inTeam) {
		return refuse("change-role-only-below-your-own", "only a role below your own")
	}

	return nil
}

// callerIn resolves the caller's reach in teamID. The interceptor resolved the same thing to let the
// call in; the resolver is cached, so asking again costs a cache read.
func (s *Service) callerIn(ctx context.Context, teamID uint64) (callerReach, error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return callerReach{}, connect.NewError(connect.CodeUnauthenticated, err)
	}

	access, err := s.resolver.Resolve(ctx, identity.GetIdentityId(), teamID)
	if err != nil {
		return callerReach{}, connect.NewError(connect.CodeInternal, err)
	}

	return callerReach{id: identity.GetIdentityId(), root: access.RootRole, inTeam: access.Role}, nil
}

// teamTypeOf asks team_service. A grant must not go through on a type it could not check, so an
// unknown team — or team_service unreachable — is a refusal, never a pass.
func (s *Service) teamTypeOf(ctx context.Context, teamID uint64) (teamv1.TeamType, error) {
	if teamID == san_auth.RootTeamID {
		return teamv1.TeamType_TEAM_TYPE_ROOT, nil
	}

	teams := s.teams.resolve(ctx, san_auth.GetBearer(ctx), []uint64{teamID})

	team, found := teams[teamID]
	if !found {
		return teamv1.TeamType_TEAM_TYPE_UNSPECIFIED, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("cannot check team %d's type: it does not exist, or team_service is unreachable", teamID))
	}

	return teamv1.TeamType(team.Type), nil
}

// lockMembership locks the person's USER row and reads their role in the team, inside tx.
//
// The lock is what makes "read the role, check it, write" safe. Without it an Owner could read
// "Admin", Root could make that person an Owner, and the Owner's write would then demote an Owner.
// Every membership write for one person goes through this row, so they queue instead of interleaving.
// It also proves the user exists.
//
// The locking read returns the person's suspension too: it is the same row, so reading it there costs
// nothing, and it is read under the lock SuspendUser also takes — a suspend and an add of one person queue.
func lockMembership(tx *gorm.DB, userID, teamID uint64) (lockedMember, error) {
	var people []personRow

	err := tx.
		Model(&user_service_models.User{}).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "is_suspended", "erased_at").
		Where("id = ?", userID).
		Find(&people).
		Error
	if err != nil {
		return lockedMember{}, connect.NewError(connect.CodeInternal, err)
	}

	if len(people) == 0 {
		return lockedMember{}, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}

	var row roleRow

	// Find, not First: a person who is not a member is role 0, not an error.
	err = tx.
		Table("user_team_roles").
		Select("role").
		Where("team_id = ? AND user_id = ?", teamID, userID).
		Limit(1).
		Find(&row).
		Error
	if err != nil {
		return lockedMember{}, connect.NewError(connect.CodeInternal, err)
	}

	return lockedMember{
		role:      role_basev1.Role(row.Role),
		suspended: people[0].IsSuspended,
		erased:    people[0].ErasedAt != nil,
	}, nil
}

// lockedMember is what lockMembership read under the lock: the person's role in the team (UNSPECIFIED = not a
// member), and whether their account is suspended, or erased for good (an-erased-account-is-final).
type lockedMember struct {
	role      role_basev1.Role
	suspended bool
	erased    bool
}

type personRow struct {
	ID          uint64
	IsSuspended bool
	ErasedAt    *time.Time
}

type roleRow struct {
	Role int32
}

// refuseSuspendedNewcomer: a suspended user cannot be newly given anything
// (a-suspended-user-is-never-picked) — so never added to a team, including as a new team's first Owner.
// A suspended MEMBER keeps their membership and may still be changed or removed.
func refuseSuspendedNewcomer(locked lockedMember) error {
	if locked.role == role_basev1.Role_ROLE_UNSPECIFIED && locked.erased {
		return connect.NewError(connect.CodeFailedPrecondition,
			errors.New("an erased account joins no team (an-erased-account-is-final)"))
	}

	if locked.role == role_basev1.Role_ROLE_UNSPECIFIED && locked.suspended {
		return connect.NewError(connect.CodeFailedPrecondition,
			errors.New("a suspended user cannot be added to a team (a-suspended-user-is-never-picked)"))
	}

	return nil
}

// checkSuspend decides a suspend or an unsuspend (only-root-and-the-administrator-suspend). The target is
// judged by its root-team role: a Root is never suspended, an Administrator only by Root.
func checkSuspend(caller callerReach, target uint64, targetRoot role_basev1.Role) error {
	if target == caller.id {
		return refuse("only-root-and-the-administrator-suspend", "nobody suspends themselves")
	}

	if !caller.isRoot() && !caller.isAdministrator() {
		return refuse("only-root-and-the-administrator-suspend", "only Root and the Administrator suspend")
	}

	if targetRoot == role_basev1.Role_ROLE_ROOT {
		return refuse("only-root-and-the-administrator-suspend", "a Root is never suspended")
	}

	if targetRoot == role_basev1.Role_ROLE_ADMINISTRATOR && !caller.isRoot() {
		return refuse("only-root-and-the-administrator-suspend", "only Root suspends an Administrator")
	}

	return nil
}
