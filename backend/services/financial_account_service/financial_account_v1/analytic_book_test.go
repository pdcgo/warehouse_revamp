package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// A small book for team A, every figure checkable by hand:
//
//	day 10  BCA Ops opens 1.000.000 · Kas opens 100.000
//	day 5   withdrawal +500.000 into BCA Ops (shop 501)
//	day 3   transfer 200.000 BCA Ops → Kas
//	day 1   capital out 50.000 from Kas
//
// So BCA Ops closes 1.300.000, Kas 250.000, the team 1.550.000.
func book(t *testing.T) (*gorm.DB, *financial_account_v1.Service, uint64, uint64) {
	t.Helper()

	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000001", 1_000_000))
	kas := mustCreate(t, svc, cash(teamA, "Kas", 100_000))

	if _, err := shopSet(svc, teamA, 501, ops.GetId()); err != nil {
		t.Fatalf("shop set: %v", err)
	}

	withdraw(t, svc, "evt-book-1", teamA, 501, -500_000, day(5))
	mustTransfer(t, svc, teamA, ops.GetId(), kas.GetId(), 200_000, day(3))

	_, err := svc.FinancialAccountCapital(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: teamA, AccountId: kas.GetId(), Direction: financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_OUT, Amount: 50_000, OccurredOn: day(1),
	}))
	if err != nil {
		t.Fatalf("capital: %v", err)
	}

	// Another team's money must never show.
	mustCreate(t, svc, cash(teamB, "Kas B", 7_777))

	return db, svc, ops.GetId(), kas.GetId()
}

func window(from, to int) *financial_accountv1.AnalyticDateRange {
	return &financial_accountv1.AnalyticDateRange{StartDate: day(from), EndDate: day(to)}
}

func groupSearch(t *testing.T, svc *financial_account_v1.Service, groupType financial_accountv1.AnalyticGroupType) []*financial_accountv1.AnalyticGroupMetricItem {
	t.Helper()

	filter := &financial_accountv1.AnalyticGroupFilter{DateRange: window(6, 0), GroupType: groupType}

	ranked, err := svc.AnalyticGroupSearch(asAni(), connect.NewRequest(&financial_accountv1.AnalyticGroupSearchRequest{
		TeamId: teamA, Filter: filter, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	filled, err := svc.AnalyticGroupMetric(asAni(), connect.NewRequest(&financial_accountv1.AnalyticGroupMetricRequest{
		TeamId: teamA, Filter: filter, Keys: ranked.Msg.GetKeys(),
	}))
	if err != nil {
		t.Fatalf("metric: %v", err)
	}

	return filled.Msg.GetItems()
}
