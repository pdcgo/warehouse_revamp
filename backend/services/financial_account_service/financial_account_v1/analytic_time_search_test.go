package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

func TestAnalyticTimeSearch_DailyNewestFirstWithQuietDays(t *testing.T) {
	_, svc, ops, _ := book(t)

	resp, err := svc.AnalyticTimeSearch(asAni(), connect.NewRequest(&financial_accountv1.AnalyticTimeSearchRequest{
		TeamId:    teamA,
		Timeframe: financial_accountv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY,
		Filter:    &financial_accountv1.AnalyticTimeSearchFilter{DateRange: window(10, 0)},
		SortType:  commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
		Page:      &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("time search: %v", err)
	}

	points := resp.Msg.GetDatas()
	if len(points) != 11 || resp.Msg.GetPageInfo().GetTotalItems() != 11 {
		t.Fatalf("points = %d", len(points))
	}

	// Today is quiet and carries the team's balance.
	if points[0].GetAt() != day(0) || points[0].GetMetric().GetChange() != 0 || points[0].GetMetric().GetCloseBalance() != 1_550_000 {
		t.Fatalf("today = %+v", points[0])
	}

	// Day 3: a transfer between the team's own accounts nets to zero.
	for _, p := range points {
		if p.GetAt() == day(3) && (p.GetMetric().GetTransfer() != 0 || p.GetMetric().GetChange() != 0) {
			t.Fatalf("day 3 = %+v", p.GetMetric())
		}

		if p.GetAt() == day(5) && p.GetMetric().GetWithdrawal() != 500_000 {
			t.Fatalf("day 5 = %+v", p.GetMetric())
		}
	}

	// One account: its own transfer shows.
	resp, err = svc.AnalyticTimeSearch(asAni(), connect.NewRequest(&financial_accountv1.AnalyticTimeSearchRequest{
		TeamId:    teamA,
		Timeframe: financial_accountv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_YEARLY,
		Filter:    &financial_accountv1.AnalyticTimeSearchFilter{DateRange: window(4, 0), AccountId: ops},
		Page:      &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("one account: %v", err)
	}

	total := financial_accountv1.FinancialAccountMetric{}
	for _, p := range resp.Msg.GetDatas() {
		total.Transfer += p.GetMetric().GetTransfer()
		total.CloseBalance = p.GetMetric().GetCloseBalance()
	}

	if total.Transfer != -200_000 || total.CloseBalance != 1_300_000 {
		t.Fatalf("ops = %+v", &total)
	}
}
