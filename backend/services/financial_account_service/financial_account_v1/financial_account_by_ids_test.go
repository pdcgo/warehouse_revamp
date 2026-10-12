package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// An archived account still resolves — an old row names it. Another team's is absent.
func TestFinancialAccountByIds_ResolvesArchivedButNeverAnotherTeams(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := mustCreate(t, svc, cash(teamA, "Kas", 0))
	theirs := mustCreate(t, svc, cash(teamB, "Kas B", 0))

	_, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: mine.GetId()}))
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	resp, err := svc.FinancialAccountByIds(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountByIdsRequest{
		TeamId: teamA,
		Filter: &financial_accountv1.FinancialAccountByIdsFilter{Ids: []uint64{mine.GetId(), theirs.GetId(), 999_999}},
	}))
	if err != nil {
		t.Fatalf("by ids: %v", err)
	}

	items := resp.Msg.GetItems()
	if len(items) != 1 {
		t.Fatalf("items = %d, want only mine", len(items))
	}

	got := items[mine.GetId()].GetItems()[0].GetAccount().GetMapData()[mine.GetId()]
	if got.GetStatus() != financial_accountv1.FinancialAccountStatus_FINANCIAL_ACCOUNT_STATUS_ARCHIVED {
		t.Fatalf("status = %v", got.GetStatus())
	}
}
