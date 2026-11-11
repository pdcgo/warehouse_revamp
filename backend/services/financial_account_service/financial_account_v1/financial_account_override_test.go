package financial_account_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// asCaller is a request context as the access interceptor leaves it: who is calling, the team the call is scoped to,
// and their role there. ROLE_UNSPECIFIED is Root or the Administrator, in by the root-team bypass.
func asCaller(userID, scope uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: userID})
	ctx = san_auth.WithScope(ctx, scope)

	return san_auth.WithCallerRole(ctx, role)
}

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): a movement Root posts from outside the team says
// so — on BOTH legs of a transfer — and the same movement by the team's own owner does not.
func TestFinancialAccountOverride_EachRowCarriesItsPoster(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	root := asCaller(1, teamA, role_basev1.Role_ROLE_UNSPECIFIED)
	owner := asCaller(ani, teamA, role_basev1.Role_ROLE_SELLING_OWNER)

	kas := mustCreate(t, svc, cash(teamA, "Kas", 1_000))
	bank := mustCreate(t, svc, bca(teamA, "BCA", "9100000077", 0))

	capital := func(ctx context.Context) {
		_, err := svc.FinancialAccountCapital(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
			TeamId: teamA, AccountId: kas.GetId(), Direction: financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN,
			Amount: 500, OccurredOn: day(1),
		}))
		if err != nil {
			t.Fatalf("capital: %v", err)
		}
	}

	move := func(ctx context.Context) {
		_, err := svc.FinancialAccountTransfer(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountTransferRequest{
			TeamId: teamA, FromAccountId: kas.GetId(), ToAccountId: bank.GetId(), Amount: 100, OccurredOn: day(0),
		}))
		if err != nil {
			t.Fatalf("transfer: %v", err)
		}
	}

	capital(root)
	capital(owner)
	move(root)
	move(owner)

	// Kas: opening (asAni, unscoped), Root's capital, the owner's capital, Root's transfer out, the owner's transfer out.
	wantKas := []bool{false, true, false, true, false}
	// BCA: opening, Root's transfer in, the owner's transfer in.
	wantBank := []bool{false, true, false}

	for _, c := range []struct {
		name string
		id   uint64
		want []bool
	}{{"Kas", kas.GetId(), wantKas}, {"BCA", bank.GetId(), wantBank}} {
		rows := logs(t, db, c.id)
		if len(rows) != len(c.want) {
			t.Fatalf("%s: %d rows, want %d", c.name, len(rows), len(c.want))
		}

		for i, row := range rows {
			if row.IsOverride != c.want[i] {
				t.Errorf("%s row %d (%s %v): is_override = %v, want %v",
					c.name, i, row.ChangeType, row.Change, row.IsOverride, c.want[i])
			}
		}
	}
}

// AN OVERRIDE IS STAMPED DOWNSTREAM OF AN EVENT: a listener's row names the event's actor, so it carries the event's
// `actor_is_override` — a withdrawal settlement's row's stamp, a team payment the confirmer's, on BOTH its legs. A
// listener has no caller; the event is the only source.
func TestFinancialAccountOverride_AListenersRowCarriesItsEventsStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "9500000031", 0))
	if _, err := shopSet(svc, teamA, 501, ops.GetId()); err != nil {
		t.Fatalf("shop set: %v", err)
	}

	payer := mustCreate(t, svc, bca(teamA, "BCA Seller", "9500000032", 1_000_000))
	creditor := mustCreate(t, svc, bca(teamB, "BCA Gudang", "9500000033", 0))

	for _, override := range []bool{true, false} {
		suffix := map[bool]string{true: "root", false: "member"}[override]

		withdrawal := settlementEvent("evt-ov-w-"+suffix, teamA, 501, settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, -1_000, day(1))
		withdrawal.GetSettlementLogPosted().ActorIsOverride = override

		err := svc.WithdrawalHandler()(context.Background(), withdrawal)
		if err != nil {
			t.Fatalf("withdrawal (%s): %v", suffix, err)
		}

		rows := logs(t, db, ops.GetId())
		if got := rows[len(rows)-1]; got.ChangeType != m.ChangeWithdrawal || got.IsOverride != override {
			t.Errorf("withdrawal (%s): row %s is_override = %v, want %v", suffix, got.ChangeType, got.IsOverride, override)
		}

		paymentID := map[bool]uint64{true: 71, false: 72}[override]

		payment := acceptedEvent("evt-ov-tp-"+suffix, paymentID, payer.GetId(), creditor.GetId(), 10_000)
		payment.GetLiabilityPaymentAccepted().ActorIsOverride = override

		err = accept(svc, payment)
		if err != nil {
			t.Fatalf("team payment (%s): %v", suffix, err)
		}

		for _, account := range []uint64{payer.GetId(), creditor.GetId()} {
			legs := logs(t, db, account)
			if got := legs[len(legs)-1]; got.ChangeType != m.ChangeTeamPayment || got.IsOverride != override {
				t.Errorf("team payment (%s): account %d's leg %s is_override = %v, want %v",
					suffix, account, got.ChangeType, got.IsOverride, override)
			}
		}
	}
}

// rootOutside is Root, in by the root-team bypass, inside a team it holds no role in; ownerIn is that team's own owner.
func rootOutside(scope uint64) context.Context {
	return asCaller(1, scope, role_basev1.Role_ROLE_UNSPECIFIED)
}

func ownerIn(scope uint64) context.Context {
	return asCaller(ani, scope, role_basev1.Role_ROLE_SELLING_OWNER)
}
