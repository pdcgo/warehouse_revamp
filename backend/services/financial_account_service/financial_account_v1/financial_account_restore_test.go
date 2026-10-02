package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Restore puts it back — same id, same rows — and a hand row is accepted again.
func TestFinancialAccountRestore_PutsItBack(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas", 0))
	b := mustCreate(t, svc, cash(teamA, "Kas 2", 100))

	_, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: a.GetId()}))
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	if err := transfer(svc, teamA, b.GetId(), a.GetId(), 10, day(0)); connectCode(t, err) != connect.CodeFailedPrecondition {
		t.Fatalf("an archived account took a hand row: %v", err)
	}

	resp, err := svc.FinancialAccountRestore(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountRestoreRequest{TeamId: teamA, AccountId: a.GetId()}))
	if err != nil {
		t.Fatalf("restore: %v", err)
	}

	if resp.Msg.GetAccount().GetStatus() != financial_accountv1.FinancialAccountStatus_FINANCIAL_ACCOUNT_STATUS_ACTIVE || resp.Msg.GetAccount().GetId() != a.GetId() {
		t.Fatalf("restored = %+v", resp.Msg.GetAccount())
	}

	mustTransfer(t, svc, teamA, b.GetId(), a.GetId(), 10, day(0))
}
