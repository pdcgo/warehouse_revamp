package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// Two legs, one act — both balances move, the team's total does not.
func TestFinancialAccountTransfer_PostsTwoLegsSharingAGroup(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "9000000001", 1_000_000))
	pay := mustCreate(t, svc, bca(teamA, "ShopeePay", "9000000002", 0))

	resp, err := svc.FinancialAccountTransfer(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountTransferRequest{
		TeamId: teamA, FromAccountId: ops.GetId(), ToAccountId: pay.GetId(), Amount: 250_000.4, OccurredOn: day(2), Note: "top-up",
	}))
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}

	legs := resp.Msg.GetLogs()
	if len(legs) != 2 || legs[0].GetGroupId() != legs[1].GetGroupId() || legs[0].GetGroupId() == 0 {
		t.Fatalf("legs = %+v", legs)
	}

	// Rounded to whole rupiah as it posts.
	if legs[0].GetChange() != -250_000 || legs[1].GetChange() != 250_000 {
		t.Fatalf("changes = %v, %v", legs[0].GetChange(), legs[1].GetChange())
	}

	if balance(t, db, ops.GetId()) != 750_000 || balance(t, db, pay.GetId()) != 250_000 {
		t.Fatal("balances did not move by the transfer")
	}

	if legs[1].GetDescription() != "From BCA Ops — top-up" || legs[0].GetActorId() != ani {
		t.Fatalf("in leg = %+v", legs[1])
	}
}

// below-zero-is-warned-never-refused.
func TestFinancialAccountTransfer_MayTakeAnAccountBelowZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas", 100))
	b := mustCreate(t, svc, cash(teamA, "Kas 2", 0))

	mustTransfer(t, svc, teamA, a.GetId(), b.GetId(), 500, day(0))

	if balance(t, db, a.GetId()) != -400 {
		t.Fatalf("balance = %v", balance(t, db, a.GetId()))
	}
}

func TestFinancialAccountTransfer_Refusals(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas", 100))
	b := mustCreate(t, svc, cash(teamA, "Kas 2", 0))
	theirs := mustCreate(t, svc, cash(teamB, "Kas B", 0))
	gone := mustCreate(t, svc, cash(teamA, "Gone", 0))

	_, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: gone.GetId()}))
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	unknown := m.FinancialAccount{TeamID: teamA, Type: m.TypeUnknown, Provider: m.ProviderUnknown, Status: m.StatusActive, Name: "Unknown — shop #501"}
	if err := db.Create(&unknown).Error; err != nil {
		t.Fatalf("seed unknown: %v", err)
	}

	cases := []struct {
		name     string
		from, to uint64
		amount   float64
		on       string
		want     connect.Code
	}{
		{"the same account", a.GetId(), a.GetId(), 10, day(0), connect.CodeInvalidArgument},
		{"nothing", a.GetId(), b.GetId(), 0, day(0), connect.CodeInvalidArgument},
		{"tomorrow", a.GetId(), b.GetId(), 10, day(-1), connect.CodeInvalidArgument},
		{"another team's", a.GetId(), theirs.GetId(), 10, day(0), connect.CodeNotFound},
		{"an archived one", a.GetId(), gone.GetId(), 10, day(0), connect.CodeFailedPrecondition},
		{"into an unknown one", a.GetId(), unknown.ID, 10, day(0), connect.CodeInvalidArgument},
	}

	for _, c := range cases {
		err := transfer(svc, teamA, c.from, c.to, c.amount, c.on)
		if code := connectCode(t, err); code != c.want {
			t.Errorf("%s: code = %v, want %v", c.name, code, c.want)
		}
	}

	if balance(t, db, a.GetId()) != 100 {
		t.Fatal("a refused transfer moved money")
	}
}
