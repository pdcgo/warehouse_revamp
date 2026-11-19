package access_interceptors

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// ── who may cancel a pending payment (a-pending-payment-is-cancelled-by-its-selling-team) ───────────────────────────
//
// Through a REAL Connect handler, as monitor_test.go does: the policy on LiabilityPaymentCancelRequest and the RPC's
// idempotency level (a write — never NO_SIDE_EFFECTS) are what the interceptor reads, so only a served request proves
// the paying selling team's owner and admin pass and every other role is refused before the handler.

const cancelPayer = uint64(41) // the paying team

type cancelledPayments struct {
	liabilityv1connect.UnimplementedLiabilityPaymentServiceHandler
	heard *heard
}

func (c cancelledPayments) LiabilityPaymentCancel(
	ctx context.Context,
	_ *connect.Request[liabilityv1.LiabilityPaymentCancelRequest],
) (*connect.Response[liabilityv1.LiabilityPaymentCancelResponse], error) {
	*c.heard = heard{reached: true, monitor: san_auth.IsMonitor(ctx), role: san_auth.GetCallerRole(ctx)}

	return connect.NewResponse(&liabilityv1.LiabilityPaymentCancelResponse{}), nil
}

func cancelServer(t *testing.T, resolver RoleResolver) (liabilityv1connect.LiabilityPaymentServiceClient, *heard) {
	t.Helper()

	interceptors := connect.WithInterceptors(NewInterceptor(testSigner(), resolver, WithAgentVerifier(agents),
		WithTeamKinds(kindsStub{})))
	record := &heard{}

	mux := http.NewServeMux()
	mux.Handle(liabilityv1connect.NewLiabilityPaymentServiceHandler(cancelledPayments{heard: record}, interceptors))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return liabilityv1connect.NewLiabilityPaymentServiceClient(server.Client(), server.URL), record
}

func cancelAs(t *testing.T, client liabilityv1connect.LiabilityPaymentServiceClient, team uint64, token string) error {
	t.Helper()

	req := connect.NewRequest(&liabilityv1.LiabilityPaymentCancelRequest{TeamId: team, PaymentId: 9})
	req.Header().Set("Authorization", "Bearer "+token)

	_, err := client.LiabilityPaymentCancel(context.Background(), req)

	return err
}

// The paying selling team's OWNER and ADMIN reach the handler, as themselves.
func TestCancelPayment_TheSellingOwnerAndAdminMay(t *testing.T) {
	for _, role := range []role_basev1.Role{role_basev1.Role_ROLE_SELLING_OWNER, role_basev1.Role_ROLE_SELLING_ADMIN} {
		t.Run(role.String(), func(t *testing.T) {
			client, record := cancelServer(t, memberOf(cancelPayer, role))

			err := cancelAs(t, client, cancelPayer, tokenFor(t, 21))
			if err != nil {
				t.Fatalf("%s cancelling its team's payment was refused: %v", role, err)
			}

			if !record.reached || record.role != role {
				t.Fatalf("the handler heard reached=%v role=%v, want %v", record.reached, record.role, role)
			}
		})
	}
}

// NO OTHER ROLE: the selling CS, and a warehouse's owner, admin and staff — a warehouse payer cancels nothing. Refused
// before the handler.
func TestCancelPayment_EveryOtherTeamRoleIsRefused(t *testing.T) {
	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	} {
		t.Run(role.String(), func(t *testing.T) {
			client, record := cancelServer(t, memberOf(cancelPayer, role))

			err := cancelAs(t, client, cancelPayer, tokenFor(t, 21))
			if connect.CodeOf(err) != connect.CodePermissionDenied {
				t.Fatalf("%s cancelling a payment answered %v, want PermissionDenied", role, err)
			}

			if record.reached {
				t.Fatalf("%s reached the cancel handler", role)
			}
		})
	}
}

// THE ADMIN TEAM'S MONITOR never cancels — the cancel is a WRITE, and a monitor only reads (the-admin-team-monitors-
// read-only). And an AGENT's credential never writes (an-agent-only-reads-for-now), even one connected by the team's
// owner.
func TestCancelPayment_AMonitorAndAnAgentAreRefused(t *testing.T) {
	client, record := cancelServer(t, adminTeamMember(role_basev1.Role_ROLE_ADMIN_OWNER))

	err := cancelAs(t, client, monitoredTeam, tokenFor(t, monitorPerson))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a monitor's cancel answered %v, want PermissionDenied", err)
	}

	if record.reached {
		t.Fatal("a monitor's cancel reached the handler")
	}

	agentClient, agentRecord := cancelServer(t, memberOf(agentTeam, role_basev1.Role_ROLE_SELLING_OWNER))

	err = cancelAs(t, agentClient, agentTeam, agentToken)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("an agent's cancel answered %v, want PermissionDenied", err)
	}

	if agentRecord.reached {
		t.Fatal("an agent's cancel reached the handler")
	}
}

// ROOT passes, as it passes every policy — its act is an override; the handler then refuses a payer that is not a
// selling team (liability_v1 TestPaymentCancel_AWarehousePayerCannotCancel).
func TestCancelPayment_RootPassesAsAnOverride(t *testing.T) {
	root := stubResolver{roles: map[uint64]role_basev1.Role{san_auth.RootTeamID: role_basev1.Role_ROLE_ROOT}}

	client, record := cancelServer(t, root)

	err := cancelAs(t, client, cancelPayer, tokenFor(t, 1))
	if err != nil {
		t.Fatalf("root's cancel answered %v, want a pass", err)
	}

	if !record.reached || record.monitor {
		t.Fatalf("the handler heard reached=%v monitor=%v, want reached and not a monitor", record.reached, record.monitor)
	}
}
