package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// A small book for team A, every figure checkable by hand:
//
//	day 20  Tabungan opens 30.000 — and never moves again (the QUIET account)
//	day 10  BCA Ops opens 1.000.000 · Kas opens 100.000
//	day 5   withdrawal +500.000 into BCA Ops (shop 501)
//	day 3   transfer 200.000 BCA Ops → Kas
//	day 1   capital out 50.000 from Kas
//
// So BCA Ops closes 1.300.000, Kas 250.000, Tabungan 30.000, the team 1.580.000. Team B holds Kas B (7.777); the
// warehouse holds Kas Gudang (250.000 on day 10, capital in 10.000 on day 2).
type financeBook struct {
	db                    *gorm.DB
	svc                   *financial_account_v1.Service
	ops, kas, quiet       uint64
	otherTeams, warehouse uint64
}

const teamW uint64 = 9_103

const (
	metricChanges = "metrics/financial_accounts"
	metricTypes   = "metrics/financial_accounts/types"
)

func book(t *testing.T) financeBook {
	t.Helper()

	db := san_testdb.DB(t)
	svc := newService(t, db)

	quietSpec := cash(teamA, "Tabungan", 30_000)
	quietSpec.on = day(20)
	quiet := mustCreate(t, svc, quietSpec)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000001", 1_000_000))
	kas := mustCreate(t, svc, cash(teamA, "Kas", 100_000))

	if _, err := shopSet(svc, teamA, 501, ops.GetId()); err != nil {
		t.Fatalf("shop set: %v", err)
	}

	withdraw(t, svc, "evt-book-1", teamA, 501, -500_000, day(5))
	mustTransfer(t, svc, teamA, ops.GetId(), kas.GetId(), 200_000, day(3))
	capital(t, svc, teamA, kas.GetId(), financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_OUT, 50_000, day(1))

	// Another team's money must never show.
	other := mustCreate(t, svc, cash(teamB, "Kas B", 7_777))

	// A warehouse has accounts too (every-team-reads-its-own-finance).
	gudang := mustCreate(t, svc, cash(teamW, "Kas Gudang", 250_000))
	capital(t, svc, teamW, gudang.GetId(), financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN, 10_000, day(2))

	return financeBook{db: db, svc: svc, ops: ops.GetId(), kas: kas.GetId(), quiet: quiet.GetId(), otherTeams: other.GetId(), warehouse: gudang.GetId()}
}

func capital(t *testing.T, svc *financial_account_v1.Service, team, account uint64, dir financial_accountv1.CapitalDirection, amount float64, on string) {
	t.Helper()

	_, err := svc.FinancialAccountCapital(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: team, AccountId: account, Direction: dir, Amount: amount, OccurredOn: on,
	}))
	if err != nil {
		t.Fatalf("capital: %v", err)
	}
}

// window is the date range filter from `from` days ago to `to` days ago.
func window(from, to int) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_DateRangeFilter{
		DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: day(from), DateMax: day(to)},
	}}
}

func accountsFilter(ids ...uint64) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_AccountFilter{
		AccountFilter: &analytic_basev1.AccountFilter{AccountIds: ids},
	}}
}

func idKeys(ids ...uint64) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}}
}

func dayKeys(days ...string) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}}
}

// search ranks a page of keys of one metric.
func search(
	t *testing.T, svc *financial_account_v1.Service, team uint64, group analytic_basev1.GroupType,
	metricID, field string, dir analytic_basev1.SortType, filters ...*analytic_basev1.FilterItem,
) *financial_accountv1.MetricSearchResponse {
	t.Helper()

	resp, err := svc.MetricSearch(asAni(), connect.NewRequest(&financial_accountv1.MetricSearchRequest{
		TeamId:  team,
		GroupBy: group,
		Filters: filters,
		Sort:    &analytic_basev1.MetricSort{MetricId: metricID, Field: field, SortType: dir},
		Page:    &analytic_basev1.PaginationFilter{Offset: 0, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	return resp.Msg
}

// fill reads both metrics for some keys.
func fill(
	t *testing.T, svc *financial_account_v1.Service, team uint64, group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys, filters ...*analytic_basev1.FilterItem,
) *financial_accountv1.MetricDataResponse {
	t.Helper()

	resp, err := svc.MetricData(asAni(), connect.NewRequest(&financial_accountv1.MetricDataRequest{
		TeamId:    team,
		GroupBy:   group,
		Filters:   filters,
		Keys:      keys,
		MetricIds: []string{metricChanges, metricTypes},
	}))
	if err != nil {
		t.Fatalf("data: %v", err)
	}

	return resp.Msg
}

// headline is the SUMMARY of Account changes.
func headline(t *testing.T, svc *financial_account_v1.Service, team uint64, filters ...*analytic_basev1.FilterItem) *financial_accountv1.AccountChangeMetric {
	t.Helper()

	return fill(t, svc, team, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, filters...).GetMetricDatas()[0].GetChangesSummary()
}

// typeSum adds the nine change-type fields — what `change` must equal.
func typeSum(c *financial_accountv1.AccountChangeMetric) float64 {
	return c.GetExpense() + c.GetAdsExpense() + c.GetAdjustment() + c.GetWithdrawal() + c.GetRestock() +
		c.GetAccountOpening() + c.GetTransfer() + c.GetTeamPayment() + c.GetCapital()
}
