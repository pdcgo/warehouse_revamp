package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestFinancialAccountOverview_BalancesAndTotalsByType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "7777000001", 1_000_000))
	gaji := mustCreate(t, svc, bca(teamA, "BCA Gaji", "7777000002", 200_000))
	kas := mustCreate(t, svc, cash(teamA, "Kas", 50_000))
	mustCreate(t, svc, cash(teamB, "Kas B", 9_999))

	// below-zero-is-warned-never-refused: Gaji goes below zero, and it posts.
	mustTransfer(t, svc, teamA, gaji.GetId(), ops.GetId(), 300_000, day(1))

	resp, err := svc.FinancialAccountOverview(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountOverviewRequest{
		TeamId: teamA,
		Filter: &financial_accountv1.FinancialAccountOverviewFilter{AccountIds: []uint64{ops.GetId(), gaji.GetId(), kas.GetId()}},
		MetricRequest: []financial_accountv1.FinancialAccountMetricDataType{
			financial_accountv1.FinancialAccountMetricDataType_FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_BALANCE,
			financial_accountv1.FinancialAccountMetricDataType_FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_TYPE_TOTAL,
		},
	}))
	if err != nil {
		t.Fatalf("overview: %v", err)
	}

	balances := resp.Msg.GetItems()[0].GetBalance().GetMapData()
	if balances[ops.GetId()].GetBalance() != 1_300_000 || balances[gaji.GetId()].GetBalance() != -100_000 || balances[kas.GetId()].GetBalance() != 50_000 {
		t.Fatalf("balances = %+v", balances)
	}

	// Never reconciled — no stamp.
	if balances[ops.GetId()].GetReconciledAt() != nil {
		t.Fatal("reconciled_at set on an account never checked")
	}

	totals := resp.Msg.GetItems()[1].GetTypeTotal().GetItems()
	if len(totals) != 2 {
		t.Fatalf("totals = %+v", totals)
	}

	bank, box := totals[0], totals[1]
	if bank.GetType() != financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT ||
		bank.GetBalance() != 1_200_000 || bank.GetAccountCount() != 2 || bank.GetBelowZeroCount() != 1 {
		t.Fatalf("bank = %+v", bank)
	}

	if box.GetBalance() != 50_000 || box.GetBelowZeroCount() != 0 {
		t.Fatalf("cash = %+v", box)
	}
}

// the-archive-is-its-own-view: the archive's type tabs count the ARCHIVED, from the server — not from a page of rows.
func TestFinancialAccountOverview_ArchivedTotalsCountTheArchived(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mustCreate(t, svc, bca(teamA, "BCA Live", "7777000011", 1_000))

	for i, spec := range []accountSpec{
		bca(teamA, "BCA Old", "7777000012", 0),
		bca(teamA, "BNI Old", "7777000013", 0),
		cash(teamA, "Kas Old", 0),
	} {
		a := mustCreate(t, svc, spec)

		_, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: a.GetId()}))
		if err != nil {
			t.Fatalf("archive %d: %v", i, err)
		}
	}

	resp, err := svc.FinancialAccountOverview(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountOverviewRequest{
		TeamId: teamA,
		Filter: &financial_accountv1.FinancialAccountOverviewFilter{Archived: true},
		MetricRequest: []financial_accountv1.FinancialAccountMetricDataType{
			financial_accountv1.FinancialAccountMetricDataType_FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_TYPE_TOTAL,
		},
	}))
	if err != nil {
		t.Fatalf("overview: %v", err)
	}

	totals := resp.Msg.GetItems()[0].GetTypeTotal().GetItems()
	if len(totals) != 2 || totals[0].GetAccountCount() != 2 || totals[1].GetAccountCount() != 1 || totals[0].GetBalance() != 0 {
		t.Fatalf("archived totals = %+v — want 2 banks then 1 cash box, all at zero", totals)
	}
}
