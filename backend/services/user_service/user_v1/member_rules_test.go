package user_v1

import (
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
)

// Each row is one decided rule (docs/business/user/context_decision.md), checked without a database.
func TestCheckMemberWrite_TheDecidedRules(t *testing.T) {
	const (
		none          = role_basev1.Role_ROLE_UNSPECIFIED
		root          = role_basev1.Role_ROLE_ROOT
		administrator = role_basev1.Role_ROLE_ADMINISTRATOR
		whOwner       = role_basev1.Role_ROLE_WAREHOUSE_OWNER
		whAdmin       = role_basev1.Role_ROLE_WAREHOUSE_ADMIN
		staff         = role_basev1.Role_ROLE_WAREHOUSE_STAFF
		sellOwner     = role_basev1.Role_ROLE_SELLING_OWNER
		sellAdmin     = role_basev1.Role_ROLE_SELLING_ADMIN
		cs            = role_basev1.Role_ROLE_SELLING_CS
		adminOwner    = role_basev1.Role_ROLE_ADMIN_OWNER
		adminAdmin    = role_basev1.Role_ROLE_ADMIN_ADMINISTRATOR

		warehouse = teamv1.TeamType_TEAM_TYPE_WAREHOUSE
		selling   = teamv1.TeamType_TEAM_TYPE_SELLING
		adminT    = teamv1.TeamType_TEAM_TYPE_ADMIN
		rootT     = teamv1.TeamType_TEAM_TYPE_ROOT
	)

	const self, other uint64 = 1, 2

	asRoot := callerReach{id: self, root: root}
	asAdministrator := callerReach{id: self, root: administrator}
	member := func(role role_basev1.Role) callerReach { return callerReach{id: self, inTeam: role} }

	ok := connect.Code(0)
	denied := connect.CodePermissionDenied
	invalid := connect.CodeInvalidArgument

	cases := []struct {
		name   string
		caller callerReach
		write  memberWrite
		want   connect.Code
	}{
		// root-is-granted-only-through-san
		{"nobody gives Root, not even Root", asRoot, memberWrite{rootT, other, none, root}, denied},
		{"a Root's membership is not touched from the app", asRoot, memberWrite{rootT, other, root, none}, denied},

		// root-grants-the-administrator
		{"Root gives the Administrator", asRoot, memberWrite{rootT, other, none, administrator}, ok},
		{"the Administrator does not give the Administrator", asAdministrator, memberWrite{rootT, other, none, administrator}, denied},
		{"the Administrator does not remove an Administrator", asAdministrator, memberWrite{rootT, other, administrator, none}, denied},
		{"the Administrator makes an Owner", asAdministrator, memberWrite{warehouse, other, none, whOwner}, ok},

		// every-role-has-a-code-name — a role belongs to its team's type
		{"no admin-team role in a selling team", asRoot, memberWrite{selling, other, none, adminOwner}, invalid},
		{"no selling role in an admin team", asRoot, memberWrite{adminT, other, none, sellOwner}, invalid},
		{"no Administrator outside the root team", asRoot, memberWrite{warehouse, other, none, administrator}, invalid},

		// an-owner-never-makes-another-owner
		{"an Owner adds Staff", member(whOwner), memberWrite{warehouse, other, none, staff}, ok},
		{"an Owner makes an Admin", member(whOwner), memberWrite{warehouse, other, staff, whAdmin}, ok},
		{"an Owner never makes another Owner", member(sellOwner), memberWrite{selling, other, none, sellOwner}, denied},
		{"an Owner does not demote another Owner", member(whOwner), memberWrite{warehouse, other, whOwner, staff}, denied},

		// no-admin-makes-another-admin, change-role-only-below-your-own, an-admin-changes-nobodys-role
		{"an Admin adds Customer Service", member(sellAdmin), memberWrite{selling, other, none, cs}, ok},
		{"an Admin never makes another Admin", member(whAdmin), memberWrite{warehouse, other, staff, whAdmin}, denied},
		{"an Admin does not touch the Owner", member(whAdmin), memberWrite{warehouse, other, whOwner, staff}, denied},
		{"an Admin does not remove another Admin", member(whAdmin), memberWrite{warehouse, other, whAdmin, none}, denied},
		{"an Admin removes Staff", member(whAdmin), memberWrite{warehouse, other, staff, none}, ok},

		// the-admin-team-admin-alone-does-not-manage-members
		{"the admin team's Owner adds its Admin", member(adminOwner), memberWrite{adminT, other, none, adminAdmin}, ok},
		{"the admin team's Admin manages nobody", member(adminAdmin), memberWrite{adminT, other, none, adminAdmin}, denied},

		// nobody changes their own membership
		{"an Owner does not change themselves", member(whOwner), memberWrite{warehouse, self, whOwner, staff}, denied},
		{"Root does not remove their own membership", asRoot, memberWrite{warehouse, self, whOwner, none}, denied},
		{"Root may add themselves to a team they are not in (TeamCreate)", asRoot, memberWrite{selling, self, none, sellOwner}, ok},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := checkMemberWrite(c.caller, c.write)

			got := connect.CodeOf(err)
			if err == nil {
				got = 0
			}

			if got != c.want {
				t.Fatalf("code = %v, want %v (err: %v)", got, c.want, err)
			}
		})
	}
}

func TestCheckSuspend_JudgedByRole(t *testing.T) {
	const self, other uint64 = 1, 2

	root := callerReach{id: self, root: role_basev1.Role_ROLE_ROOT}
	administrator := callerReach{id: self, root: role_basev1.Role_ROLE_ADMINISTRATOR}
	owner := callerReach{id: self, inTeam: role_basev1.Role_ROLE_WAREHOUSE_OWNER}

	cases := []struct {
		name   string
		caller callerReach
		target uint64
		role   role_basev1.Role
		ok     bool
	}{
		{"Root suspends Staff", root, other, role_basev1.Role_ROLE_UNSPECIFIED, true},
		{"Root suspends an Administrator", root, other, role_basev1.Role_ROLE_ADMINISTRATOR, true},
		{"nobody suspends a Root", root, other, role_basev1.Role_ROLE_ROOT, false},
		{"the Administrator suspends Staff", administrator, other, role_basev1.Role_ROLE_UNSPECIFIED, true},
		{"the Administrator never suspends an Administrator", administrator, other, role_basev1.Role_ROLE_ADMINISTRATOR, false},
		{"nobody suspends themselves", root, self, role_basev1.Role_ROLE_ROOT, false},
		{"a team's Owner suspends nobody", owner, other, role_basev1.Role_ROLE_UNSPECIFIED, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := checkSuspend(c.caller, c.target, c.role)
			if (err == nil) != c.ok {
				t.Fatalf("allowed = %v, want %v (err: %v)", err == nil, c.ok, err)
			}
		})
	}
}
