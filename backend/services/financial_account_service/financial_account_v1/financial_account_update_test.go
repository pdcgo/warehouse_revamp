package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestFinancialAccountUpdate_EditsNameHolderDescriptionOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, bca(teamA, "BCA", "4444000004", 100))

	resp, err := svc.FinancialAccountUpdate(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountUpdateRequest{
		TeamId:      teamA,
		AccountId:   a.GetId(),
		Name:        "BCA Operasional",
		HolderName:  "PT Baru",
		Description: "withdrawals",
	}))
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	got := resp.Msg.GetAccount()
	if got.GetName() != "BCA Operasional" || got.GetHolderName() != "PT Baru" || got.GetDescription() != "withdrawals" {
		t.Fatalf("updated = %+v", got)
	}

	// Provider and number are fixed.
	if got.GetAccountNumber() != "4444000004" || got.GetProvider() != a.GetProvider() {
		t.Fatalf("identity moved: %+v", got)
	}
}

func TestFinancialAccountUpdate_RefusesANameTheTeamUses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mustCreate(t, svc, cash(teamA, "Kas", 0))
	b := mustCreate(t, svc, cash(teamA, "Kas 2", 0))

	_, err := svc.FinancialAccountUpdate(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountUpdateRequest{
		TeamId: teamA, AccountId: b.GetId(), Name: "KAS",
	}))
	if code := connectCode(t, err); code != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists", code)
	}
}

func TestFinancialAccountUpdate_AnotherTeamsAccountIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	b := mustCreate(t, svc, cash(teamB, "Kas B", 0))

	_, err := svc.FinancialAccountUpdate(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountUpdateRequest{
		TeamId: teamA, AccountId: b.GetId(), Name: "Mine now",
	}))
	if code := connectCode(t, err); code != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", code)
	}
}
