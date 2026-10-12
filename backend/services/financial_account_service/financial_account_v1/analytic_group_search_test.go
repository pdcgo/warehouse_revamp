package financial_account_v1_test

import (
	"testing"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// account-grouped-joins-the-metrics — ranked by the largest movement, each with its balance.
func TestAnalyticGroups_ByAccount(t *testing.T) {
	_, svc, ops, kas := book(t)

	items := groupSearch(t, svc, financial_accountv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_ACCOUNT)
	if len(items) != 2 {
		t.Fatalf("items = %d", len(items))
	}

	// BCA Ops moved +300.000 in the window (withdrawal, transfer out), Kas +150.000.
	first, second := items[0], items[1]
	if first.GetKey().GetAccountId() != ops || first.GetMetric().GetChange() != 300_000 || first.GetMetric().GetCloseBalance() != 1_300_000 || first.GetMetric().GetOpenBalance() != 1_000_000 {
		t.Fatalf("first = %+v", first)
	}

	if second.GetKey().GetAccountId() != kas || second.GetMetric().GetChange() != 150_000 {
		t.Fatalf("second = %+v", second)
	}
}

func TestAnalyticGroups_ByProviderAndByType(t *testing.T) {
	_, svc, _, _ := book(t)

	providers := groupSearch(t, svc, financial_accountv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_PROVIDER)
	if len(providers) != 2 || providers[0].GetKey().GetProvider() != financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA {
		t.Fatalf("providers = %+v", providers)
	}

	types := groupSearch(t, svc, financial_accountv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_CHANGE_TYPE)

	byType := map[financial_accountv1.FinancialAccountChangeType]*financial_accountv1.FinancialAccountMetric{}
	for _, item := range types {
		byType[item.GetKey().GetChangeType()] = item.GetMetric()
	}

	// Moved in the window: the withdrawal, the transfer (net zero, still moved), the capital. The openings
	// are before it.
	if len(byType) != 3 {
		t.Fatalf("types = %+v", byType)
	}

	withdrawal := byType[financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_WITHDRAWAL]
	if withdrawal.GetChange() != 500_000 || withdrawal.GetCloseBalance() != 0 {
		t.Fatalf("withdrawal = %+v", withdrawal)
	}

	if types[0].GetKey().GetChangeType() != financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_WITHDRAWAL {
		t.Fatalf("not ranked by movement: %+v", types[0])
	}
}
