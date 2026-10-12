package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// The metric answers the keys in the REQUEST's order — the order the search ranked — and a key with nothing
// behind it gets zeros rather than vanishing, so the screen's rows never shift under it.
func TestAnalyticGroupMetric_AnswersInTheRequestsOrder(t *testing.T) {
	_, svc, ops, kas := book(t)

	keys := []*financial_accountv1.AnalyticGroupKey{
		{Key: &financial_accountv1.AnalyticGroupKey_AccountId{AccountId: kas}},
		{Key: &financial_accountv1.AnalyticGroupKey_AccountId{AccountId: 999_999}},
		{Key: &financial_accountv1.AnalyticGroupKey_AccountId{AccountId: ops}},
	}

	resp, err := svc.AnalyticGroupMetric(asAni(), connect.NewRequest(&financial_accountv1.AnalyticGroupMetricRequest{
		TeamId: teamA,
		Filter: &financial_accountv1.AnalyticGroupFilter{DateRange: window(6, 0), GroupType: financial_accountv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_ACCOUNT},
		Keys:   keys,
	}))
	if err != nil {
		t.Fatalf("metric: %v", err)
	}

	items := resp.Msg.GetItems()
	if len(items) != 3 {
		t.Fatalf("items = %d", len(items))
	}

	if items[0].GetKey().GetAccountId() != kas || items[0].GetMetric().GetCloseBalance() != 250_000 {
		t.Fatalf("first = %+v", items[0])
	}

	if items[1].GetMetric().GetCloseBalance() != 0 || items[1].GetMetric().GetChange() != 0 {
		t.Fatalf("unknown key = %+v", items[1])
	}

	if items[2].GetKey().GetAccountId() != ops || items[2].GetMetric().GetWithdrawal() != 500_000 {
		t.Fatalf("third = %+v", items[2])
	}
}

// Another team's account is no key of this team — its money never shows.
func TestAnalyticGroupMetric_AnotherTeamsAccountReadsZero(t *testing.T) {
	db, svc, _, _ := book(t)

	var other uint64
	if err := db.Raw(`SELECT id FROM financial_accounts WHERE team_id = ? LIMIT 1`, teamB).Scan(&other).Error; err != nil || other == 0 {
		t.Fatalf("team B's account: %v", err)
	}

	resp, err := svc.AnalyticGroupMetric(asAni(), connect.NewRequest(&financial_accountv1.AnalyticGroupMetricRequest{
		TeamId: teamA,
		Filter: &financial_accountv1.AnalyticGroupFilter{DateRange: window(30, 0), GroupType: financial_accountv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_ACCOUNT},
		Keys:   []*financial_accountv1.AnalyticGroupKey{{Key: &financial_accountv1.AnalyticGroupKey_AccountId{AccountId: other}}},
	}))
	if err != nil {
		t.Fatalf("metric: %v", err)
	}

	if resp.Msg.GetItems()[0].GetMetric().GetCloseBalance() != 0 {
		t.Fatalf("leaked = %+v", resp.Msg.GetItems()[0])
	}
}
