package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

func statement(t *testing.T, svc *financial_account_v1.Service, team uint64, filter *financial_accountv1.FinancialAccountLogListFilter) ([]*financial_accountv1.FinancialAccountLog, error) {
	t.Helper()

	resp, err := svc.FinancialAccountLogList(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountLogListRequest{
		TeamId: team,
		Filter: filter,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		return nil, err
	}

	byID := resp.Msg.GetItems()[0].GetLog().GetMapData()
	out := []*financial_accountv1.FinancialAccountLog{}

	for _, id := range resp.Msg.GetIds() {
		out = append(out, byID[id])
	}

	return out, nil
}

// the-log-says-balance-after: newest first, each row's balance after in ENTRY order.
func TestFinancialAccountLogList_NewestFirstWithBalanceAfter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "8888000001", 1_000))
	gaji := mustCreate(t, svc, bca(teamA, "BCA Gaji", "8888000002", 0))

	mustTransfer(t, svc, teamA, ops.GetId(), gaji.GetId(), 400, day(3))
	mustTransfer(t, svc, teamA, ops.GetId(), gaji.GetId(), 100, day(5)) // typed later, dated earlier

	rows, err := statement(t, svc, teamA, &financial_accountv1.FinancialAccountLogListFilter{AccountId: ops.GetId()})
	if err != nil {
		t.Fatalf("statement: %v", err)
	}

	if len(rows) != 3 {
		t.Fatalf("rows = %d", len(rows))
	}

	// Entry order, not date order: the last typed is on top, and its balance after follows the one before it.
	if rows[0].GetChange() != -100 || rows[0].GetBalanceAfter() != 500 || rows[1].GetBalanceAfter() != 600 || rows[2].GetBalanceAfter() != 1_000 {
		t.Fatalf("statement = %+v", rows)
	}

	if rows[0].GetCounterAccountId() != gaji.GetId() || rows[0].GetGroupId() == 0 || rows[0].GetDescription() != "To BCA Gaji — test" {
		t.Fatalf("transfer leg = %+v", rows[0])
	}
}

func TestFinancialAccountLogList_FiltersByTypeAndDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "8888000003", 1_000))
	gaji := mustCreate(t, svc, bca(teamA, "BCA Gaji", "8888000004", 0))
	mustTransfer(t, svc, teamA, ops.GetId(), gaji.GetId(), 400, day(3))

	rows, err := statement(t, svc, teamA, &financial_accountv1.FinancialAccountLogListFilter{
		AccountId:   ops.GetId(),
		ChangeTypes: []financial_accountv1.FinancialAccountChangeType{financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_TRANSFER},
	})
	if err != nil || len(rows) != 1 {
		t.Fatalf("by type = %v, %v", rows, err)
	}

	// The opening row is dated 10 days ago; a window over the last 5 days leaves only the transfer.
	rows, err = statement(t, svc, teamA, &financial_accountv1.FinancialAccountLogListFilter{
		AccountId:    ops.GetId(),
		OccurredFrom: day(5),
		OccurredTo:   day(0),
	})
	if err != nil || len(rows) != 1 {
		t.Fatalf("by day = %v, %v", rows, err)
	}
}

func TestFinancialAccountLogList_AnotherTeamsAccountIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := mustCreate(t, svc, cash(teamB, "Kas B", 10))

	_, err := statement(t, svc, teamA, &financial_accountv1.FinancialAccountLogListFilter{AccountId: theirs.GetId()})
	if code := connectCode(t, err); code != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", code)
	}
}
