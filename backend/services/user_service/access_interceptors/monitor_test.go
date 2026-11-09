package access_interceptors

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// ── the admin team monitors, read-only (the-admin-team-monitors-read-only) ─────────────────────────────────────────
//
// Through REAL Connect handlers, as agent_test.go does: whether an RPC is a read is its generated spec's idempotency
// level, so a hand-built request — which carries no spec — would test nothing. LiabilityPositionList is a marked read
// whose policy names no admin-team role; TeamInfoUpdate is a write whose policy DOES name both, so its refusal shows a
// monitor's write is refused by the team it is aimed at, not by a missing role.

const (
	adminTeam     = uint64(9)
	monitoredTeam = uint64(5)
	monitorPerson = uint64(11)
)

// heard records what a handler was handed: whether it ran as a monitor, and under which caller role.
type heard struct {
	reached bool
	monitor bool
	role    role_basev1.Role
}

type monitoredPositions struct {
	liabilityv1connect.UnimplementedLiabilityServiceHandler
	heard *heard
}

func (p monitoredPositions) LiabilityPositionList(
	ctx context.Context,
	_ *connect.Request[liabilityv1.LiabilityPositionListRequest],
) (*connect.Response[liabilityv1.LiabilityPositionListResponse], error) {
	*p.heard = heard{reached: true, monitor: san_auth.IsMonitor(ctx), role: san_auth.GetCallerRole(ctx)}

	return connect.NewResponse(&liabilityv1.LiabilityPositionListResponse{}), nil
}

type monitoredTeams struct {
	teamv1connect.UnimplementedTeamServiceHandler
	heard *heard
}

func (m monitoredTeams) TeamInfoUpdate(
	ctx context.Context,
	_ *connect.Request[teamv1.TeamInfoUpdateRequest],
) (*connect.Response[teamv1.TeamInfoUpdateResponse], error) {
	*m.heard = heard{reached: true, monitor: san_auth.IsMonitor(ctx), role: san_auth.GetCallerRole(ctx)}

	return connect.NewResponse(&teamv1.TeamInfoUpdateResponse{}), nil
}

// kindsStub is team_service's answer: every team is a warehouse or a selling team, except the admin team itself and
// the ones named here.
type kindsStub map[uint64]bool

func (k kindsStub) Monitorable(_ context.Context, teamID uint64) (bool, error) {
	if teamID == adminTeam {
		return false, nil
	}

	if monitorable, named := k[teamID]; named {
		return monitorable, nil
	}

	return true, nil
}

// secondAdminTeam is another ADMIN-type team the person is not in — not a warehouse or a selling team, so not watched.
const secondAdminTeam = uint64(77)

func monitorServer(t *testing.T, resolver RoleResolver) (liabilityv1connect.LiabilityServiceClient, teamv1connect.TeamServiceClient, *heard) {
	t.Helper()

	return monitorServerWith(t, resolver, WithTeamKinds(kindsStub{secondAdminTeam: false}))
}

func monitorServerWith(t *testing.T, resolver RoleResolver, kinds Option) (liabilityv1connect.LiabilityServiceClient, teamv1connect.TeamServiceClient, *heard) {
	t.Helper()

	interceptors := connect.WithInterceptors(NewInterceptor(testSigner(), resolver, WithAgentVerifier(agents), kinds))
	record := &heard{}

	mux := http.NewServeMux()
	mux.Handle(liabilityv1connect.NewLiabilityServiceHandler(monitoredPositions{heard: record}, interceptors))
	mux.Handle(teamv1connect.NewTeamServiceHandler(monitoredTeams{heard: record}, interceptors))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return liabilityv1connect.NewLiabilityServiceClient(server.Client(), server.URL),
		teamv1connect.NewTeamServiceClient(server.Client(), server.URL),
		record
}

// adminTeamMember holds `role` in the admin team and nothing anywhere else.
func adminTeamMember(role role_basev1.Role) stubResolver {
	return stubResolver{roles: map[uint64]role_basev1.Role{adminTeam: role}, adminTeam: role}
}

func readPositions(t *testing.T, liability liabilityv1connect.LiabilityServiceClient, team uint64, token string) error {
	t.Helper()

	req := connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
		TeamId: team,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 10},
	})
	req.Header().Set("Authorization", "Bearer "+token)

	_, err := liability.LiabilityPositionList(context.Background(), req)

	return err
}

func writeTeamInfo(t *testing.T, teams teamv1connect.TeamServiceClient, team uint64, token string) error {
	t.Helper()

	req := connect.NewRequest(&teamv1.TeamInfoUpdateRequest{TeamId: team})
	req.Header().Set("Authorization", "Bearer "+token)

	_, err := teams.TeamInfoUpdate(context.Background(), req)

	return err
}

// BOTH admin-team roles read a team they are not in — as a MONITOR, with no role in it.
func TestMonitor_TheAdminTeamReadsATeamItIsNotIn(t *testing.T) {
	for _, role := range []role_basev1.Role{role_basev1.Role_ROLE_ADMIN_OWNER, role_basev1.Role_ROLE_ADMIN_ADMINISTRATOR} {
		t.Run(role.String(), func(t *testing.T) {
			liability, _, record := monitorServer(t, adminTeamMember(role))

			err := readPositions(t, liability, monitoredTeam, tokenFor(t, monitorPerson))
			if err != nil {
				t.Fatalf("%s reading a monitored team was refused: %v", role, err)
			}

			if !record.monitor || record.role != role_basev1.Role_ROLE_UNSPECIFIED {
				t.Fatalf("the handler heard monitor=%v role=%v, want monitor=true role=UNSPECIFIED", record.monitor, record.role)
			}
		})
	}
}

// ⚠ A MONITOR NEVER WRITES — refused before the handler, though the write's policy names the admin team's roles: they
// hold them in THEIR team, and this is another.
func TestMonitor_AWriteIsRefused(t *testing.T) {
	_, teams, record := monitorServer(t, adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER))

	err := writeTeamInfo(t, teams, monitoredTeam, tokenFor(t, monitorPerson))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a monitor's write answered %v, want PermissionDenied", err)
	}

	if record.reached {
		t.Fatal("a monitor's write reached its handler")
	}
}

// …while in ITS OWN team the same write goes through, as the member — monitor all, manage own.
func TestMonitor_ItsOwnTeamIsWrittenAsTheMember(t *testing.T) {
	_, teams, record := monitorServer(t, adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER))

	err := writeTeamInfo(t, teams, adminTeam, tokenFor(t, monitorPerson))
	if err != nil {
		t.Fatalf("the admin team's Owner writing its own team was refused: %v", err)
	}

	if record.monitor || record.role != role_basev1.Role_ROLE_ADMIN_OWNER {
		t.Fatalf("the handler heard monitor=%v role=%v, want the member's own role", record.monitor, record.role)
	}
}

// THE ROOT TEAM IS NEVER MONITORED — named, or reached by leaving the scope unset (step 4 sends 0 there).
func TestMonitor_NeverTheRootTeam(t *testing.T) {
	for _, team := range []uint64{san_auth.RootTeamID, 0} {
		liability, _, record := monitorServer(t, adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER))

		err := readPositions(t, liability, team, tokenFor(t, monitorPerson))
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("a monitor reading scope %d answered %v, want PermissionDenied", team, err)
		}

		if record.reached {
			t.Fatalf("a monitor's read of scope %d reached its handler", team)
		}
	}
}

// A TEAM THEY ARE IN is read as that member — monitoring never shadows a membership, even where the member's role is
// narrower than a monitor's reach.
func TestMonitor_AMembershipIsNeverShadowed(t *testing.T) {
	cs := adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER)
	cs.roles[monitoredTeam] = role_basev1.Role_ROLE_SELLING_CS

	liability, _, record := monitorServer(t, cs)

	err := readPositions(t, liability, monitoredTeam, tokenFor(t, monitorPerson))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a CS of the team (also in the admin team) answered %v, want PermissionDenied — their own role governs", err)
	}

	if record.reached {
		t.Fatal("the member's read reached its handler as a monitor")
	}
}

// Only the admin team monitors: a person with no admin-team role, outside the team, is refused the same read.
func TestMonitor_NobodyElseMonitors(t *testing.T) {
	liability, _, _ := monitorServer(t, memberOf(adminTeam+1, role_basev1.Role_ROLE_WAREHOUSE_OWNER))

	err := readPositions(t, liability, monitoredTeam, tokenFor(t, monitorPerson))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a non-member with no admin-team role answered %v, want PermissionDenied", err)
	}
}

// A SUSPENDED monitor monitors nothing: suspension is checked before every rung.
func TestMonitor_ASuspendedMonitorIsRefused(t *testing.T) {
	suspended := adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER)
	suspended.suspended = true

	liability, _, _ := monitorServer(t, suspended)

	err := readPositions(t, liability, monitoredTeam, tokenFor(t, monitorPerson))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a suspended monitor answered %v, want PermissionDenied", err)
	}
}

// AN AGENT NEVER MONITORS — a credential for the monitored team, connected by an admin-team person, reads nothing
// there: monitoring does not widen a credential (an-agent-only-reads-for-now).
func TestMonitor_AnAgentNeverMonitors(t *testing.T) {
	liability, _, _ := monitorServer(t, adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER))

	// agentToken is a one-team credential for agentTeam; read that team, which its person is not in.
	err := readPositions(t, liability, agentTeam, agentToken)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("an admin-team person's agent reading a team they are not in answered %v, want PermissionDenied", err)
	}
}

// ROOT IS UNCHANGED: it still bypasses, reads and writes, and is never marked a monitor — its writes are overrides.
func TestMonitor_RootIsUnchanged(t *testing.T) {
	root := stubResolver{
		roles:     map[uint64]role_basev1.Role{san_auth.RootTeamID: role_basev1.Role_ROLE_ROOT, adminTeam: role_basev1.Role_ROLE_ADMIN_OWNER},
		adminTeam: role_basev1.Role_ROLE_ADMIN_OWNER,
	}

	liability, teams, record := monitorServer(t, root)

	err := readPositions(t, liability, monitoredTeam, tokenFor(t, monitorPerson))
	if err != nil || record.monitor {
		t.Fatalf("root's read answered %v (monitor=%v), want a plain pass", err, record.monitor)
	}

	err = writeTeamInfo(t, teams, monitoredTeam, tokenFor(t, monitorPerson))
	if err != nil || record.monitor {
		t.Fatalf("root's write answered %v (monitor=%v), want a plain pass", err, record.monitor)
	}
}

// An UNSCOPED roles-policy is root's alone — a monitor's read of one is refused (step 10), never let in by 8b.
func TestMonitor_AnUnscopedRootPolicyIsRefused(t *testing.T) {
	unscoped := &gate{
		interceptor: &interceptor{resolver: adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER)},
		policy:      &role_basev1.RequestPolicy{Roles: []role_basev1.Role{role_basev1.Role_ROLE_ROOT}},
		userID:      monitorPerson,
		read:        true,
	}

	_, err := unscoped.authorize(context.Background(), &teamv1.TeamDeleteRequest{})
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a monitor on an unscoped root-only read answered %v, want PermissionDenied", err)
	}
}

// ONLY A WAREHOUSE OR A SELLING TEAM is monitored (the-admin-team-monitors-all-and-manages-its-own) — another
// admin-type team is not, though it is neither the root team nor one the person is in.
func TestMonitor_OnlyAWarehouseOrSellingTeam(t *testing.T) {
	liability, _, record := monitorServer(t, adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER))

	err := readPositions(t, liability, secondAdminTeam, tokenFor(t, monitorPerson))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("reading another admin-type team = %v, want PermissionDenied", err)
	}

	if record.reached {
		t.Fatal("the handler ran for a team the admin team does not monitor")
	}
}

// With no team-kinds reader wired, nobody monitors — the check fails closed.
func TestMonitor_NoReaderNoMonitoring(t *testing.T) {
	liability, _, _ := monitorServerWith(t, adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER), func(*interceptor) {})

	err := readPositions(t, liability, monitoredTeam, tokenFor(t, monitorPerson))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a monitor with no team-kinds reader = %v, want PermissionDenied", err)
	}
}
