package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// the-balance-series-is-a-running-sum: every period opens where the one before it closed, and opening + the changes =
// closing — at every grain, quiet periods included. The first opens on the balance before the window (the quiet
// account's 30.000), the last closes on the team's balance.
func TestMetricData_EveryPeriodOpensWhereTheLastClosed(t *testing.T) {
	b := book(t)

	for _, group := range []analytic_basev1.GroupType{
		analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		analytic_basev1.GroupType_GROUP_TYPE_WEEKLY,
		analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
		analytic_basev1.GroupType_GROUP_TYPE_YEARLY,
	} {
		ranked := search(t, b.svc, teamA, group, metricChanges, "closing_balance", analytic_basev1.SortType_SORT_TYPE_ASC, window(10, 0))
		days := ranked.GetKeys().GetDays().GetDays()

		if group == analytic_basev1.GroupType_GROUP_TYPE_DAILY && len(days) != 11 {
			t.Fatalf("daily: %d periods, want every day of the window", len(days))
		}

		// Read the periods oldest first, by key.
		filled := fill(t, b.svc, teamA, group, dayKeys(days...), window(10, 0)).GetMetricDatas()[0].GetChangesByDay().GetItems()

		sorted := append([]string{}, days...)
		for i := range sorted {
			for j := i + 1; j < len(sorted); j++ {
				if sorted[j] < sorted[i] {
					sorted[i], sorted[j] = sorted[j], sorted[i]
				}
			}
		}

		prevClose := 30_000.0

		for _, key := range sorted {
			p := filled[key]

			if p.GetOpeningBalance() != prevClose {
				t.Fatalf("%s %s opens at %v, the last period closed at %v", group, key, p.GetOpeningBalance(), prevClose)
			}

			if p.GetOpeningBalance()+p.GetChange() != p.GetClosingBalance() {
				t.Fatalf("%s %s: %v + %v != %v", group, key, p.GetOpeningBalance(), p.GetChange(), p.GetClosingBalance())
			}

			if typeSum(p) != p.GetChange() {
				t.Fatalf("%s %s: the types sum to %v, change is %v", group, key, typeSum(p), p.GetChange())
			}

			prevClose = p.GetClosingBalance()
		}

		if prevClose != 1_580_000 {
			t.Fatalf("%s: the last period closes at %v, want the team's 1.580.000", group, prevClose)
		}
	}
}

// the-finance-prototype-is-accepted: a period cut by the range has its edges at the range boundary — the month or year
// that began before the window opens on the window's first day, the same opening as the headline.
func TestMetricData_ACutPeriodHasItsEdgesAtTheRange(t *testing.T) {
	b := book(t)

	// From day 4: the openings (day 10, 20) and the withdrawal (day 5) are before it.
	head := headline(t, b.svc, teamA, window(4, 0))
	if head.GetOpeningBalance() != 1_630_000 || head.GetClosingBalance() != 1_580_000 || head.GetChange() != -50_000 {
		t.Fatalf("headline = %+v", head)
	}

	for _, group := range []analytic_basev1.GroupType{analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, analytic_basev1.GroupType_GROUP_TYPE_YEARLY} {
		ranked := search(t, b.svc, teamA, group, metricChanges, "closing_balance", analytic_basev1.SortType_SORT_TYPE_DESC, window(4, 0))
		days := ranked.GetKeys().GetDays().GetDays()

		filled := fill(t, b.svc, teamA, group, dayKeys(days...), window(4, 0)).GetMetricDatas()[0].GetChangesByDay().GetItems()

		first := days[0]
		for _, d := range days {
			if d < first {
				first = d
			}
		}

		// The period's own first day is before the window (the 1st of a month or a year, unless today is), its edge is
		// the range's.
		if filled[first].GetOpeningBalance() != 1_630_000 {
			t.Fatalf("%s %s opens at %v, want the range's opening 1.630.000", group, first, filled[first].GetOpeningBalance())
		}
	}

	// A day of a period asked that is not its first is refused — it would name no row.
	_, err := b.svc.MetricData(asAni(), connect.NewRequest(&financial_accountv1.MetricDataRequest{
		TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, Filters: []*analytic_basev1.FilterItem{window(4, 0)},
		Keys: dayKeys("2026-01-02"), MetricIds: []string{metricChanges},
	}))
	if connectCode(t, err) != connect.CodeInvalidArgument {
		t.Fatalf("a mid-month key: %v", err)
	}
}

// the-finance-prototype-is-accepted: a quiet account is shown, with its balance — a row of the ACCOUNT group though it
// moved nothing in the window, carried in from before.
func TestMetricSearch_AQuietAccountIsARowWithItsBalance(t *testing.T) {
	b := book(t)

	ranked := search(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, metricChanges, "change", analytic_basev1.SortType_SORT_TYPE_DESC, window(6, 0))
	ids := ranked.GetKeys().GetIds().GetIds()

	// BCA Ops moved +300.000 (withdrawal, transfer out), Kas +150.000, Tabungan nothing.
	if len(ids) != 3 || ids[0] != b.ops || ids[1] != b.kas || ids[2] != b.quiet || ranked.GetHasNext() {
		t.Fatalf("keys = %v (ops %d, kas %d, quiet %d)", ids, b.ops, b.kas, b.quiet)
	}

	filled := fill(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, idKeys(ids...), window(6, 0)).GetMetricDatas()

	quiet := filled[0].GetChangesById().GetItems()[b.quiet]
	if quiet.GetOpeningBalance() != 30_000 || quiet.GetClosingBalance() != 30_000 || quiet.GetChange() != 0 {
		t.Fatalf("quiet = %+v", quiet)
	}

	ops := filled[0].GetChangesById().GetItems()[b.ops]
	if ops.GetOpeningBalance() != 1_000_000 || ops.GetClosingBalance() != 1_300_000 || ops.GetWithdrawal() != 500_000 {
		t.Fatalf("ops = %+v", ops)
	}

	// Change types read the same key's net.
	if filled[1].GetTypesById().GetItems()[b.ops].GetAmount() != 300_000 {
		t.Fatalf("ops' amount = %+v", filled[1].GetTypesById().GetItems()[b.ops])
	}

	// The keys add up to the headline — positions across accounts, never across time.
	head := headline(t, b.svc, teamA, window(6, 0))
	if head.GetOpeningBalance() != 1_130_000 || head.GetClosingBalance() != 1_580_000 {
		t.Fatalf("headline = %+v", head)
	}

	// Ranked by balance, ascending: the quiet account's 30.000 first.
	byBalance := search(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, metricChanges, "closing_balance", analytic_basev1.SortType_SORT_TYPE_ASC, window(6, 0))
	if byBalance.GetKeys().GetIds().GetIds()[0] != b.quiet {
		t.Fatalf("by balance = %v", byBalance.GetKeys().GetIds().GetIds())
	}
}

// the-finance-prototype-is-accepted: money out is negative, so the nine type fields add up to `change`; the change type
// OPENING_BALANCE reads as `account_opening`, never the position.
func TestMetricData_MoneyOutIsNegative(t *testing.T) {
	b := book(t)

	items := fill(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, idKeys(b.ops, b.kas), window(10, 0)).GetMetricDatas()[0].GetChangesById().GetItems()

	ops, kas := items[b.ops], items[b.kas]
	if ops.GetTransfer() != -200_000 || kas.GetTransfer() != 200_000 || kas.GetCapital() != -50_000 {
		t.Fatalf("ops = %+v, kas = %+v", ops, kas)
	}

	// The accounts opened inside the window: their first deposit is the TYPE, the position before it 0.
	if ops.GetAccountOpening() != 1_000_000 || ops.GetOpeningBalance() != 0 || ops.GetClosingBalance() != 1_300_000 {
		t.Fatalf("ops = %+v", ops)
	}

	for name, c := range map[string]*financial_accountv1.AccountChangeMetric{"ops": ops, "kas": kas} {
		if typeSum(c) != c.GetChange() {
			t.Fatalf("%s: the types sum to %v, change is %v", name, typeSum(c), c.GetChange())
		}
	}

	// Change types by change type: every type that moved — the transfer nets to 0 over the team and still moved.
	ranked := search(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_CHANGE_TYPE, metricTypes, "amount", analytic_basev1.SortType_SORT_TYPE_DESC, window(10, 0))
	ids := ranked.GetKeys().GetIds().GetIds()

	opening := uint64(financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_OPENING_BALANCE)
	withdrawal := uint64(financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_WITHDRAWAL)
	transfer := uint64(financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_TRANSFER)
	capitalType := uint64(financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_CAPITAL)

	if len(ids) != 4 || ids[0] != opening || ids[1] != withdrawal || ids[2] != transfer || ids[3] != capitalType {
		t.Fatalf("types = %v", ids)
	}

	resp, err := b.svc.MetricData(asAni(), connect.NewRequest(&financial_accountv1.MetricDataRequest{
		TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_CHANGE_TYPE, Filters: []*analytic_basev1.FilterItem{window(10, 0)},
		Keys: idKeys(ids...), MetricIds: []string{metricTypes},
	}))
	if err != nil {
		t.Fatalf("types: %v", err)
	}

	amounts := resp.Msg.GetMetricDatas()[0].GetTypesById().GetItems()
	if amounts[opening].GetAmount() != 1_100_000 || amounts[withdrawal].GetAmount() != 500_000 ||
		amounts[transfer].GetAmount() != 0 || amounts[capitalType].GetAmount() != -50_000 {
		t.Fatalf("amounts = %+v", amounts)
	}

	// Account changes cannot be grouped by change type — it is greyed for that group.
	_, err = b.svc.MetricData(asAni(), connect.NewRequest(&financial_accountv1.MetricDataRequest{
		TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_CHANGE_TYPE, Filters: []*analytic_basev1.FilterItem{window(10, 0)},
		Keys: idKeys(ids...), MetricIds: []string{metricChanges},
	}))
	if connectCode(t, err) != connect.CodeInvalidArgument {
		t.Fatalf("changes by change type: %v", err)
	}
}

// finance-filters-by-account: one account or several, under every group; the provider group reads the accounts'
// providers now.
func TestMetricData_TheAccountFilterNarrowsEveryGroup(t *testing.T) {
	b := book(t)

	one := headline(t, b.svc, teamA, window(6, 0), accountsFilter(b.kas))
	if one.GetOpeningBalance() != 100_000 || one.GetClosingBalance() != 250_000 || one.GetCapital() != -50_000 {
		t.Fatalf("kas = %+v", one)
	}

	two := headline(t, b.svc, teamA, window(6, 0), accountsFilter(b.kas, b.quiet))
	if two.GetOpeningBalance() != 130_000 || two.GetClosingBalance() != 280_000 {
		t.Fatalf("kas + tabungan = %+v", two)
	}

	daily := search(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_DAILY, metricChanges, "change", analytic_basev1.SortType_SORT_TYPE_DESC, window(6, 0), accountsFilter(b.kas))
	top := daily.GetKeys().GetDays().GetDays()[0]
	if top != day(3) {
		t.Fatalf("kas' biggest day = %s, want the transfer in on %s", top, day(3))
	}

	providers := search(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_PROVIDER, metricChanges, "closing_balance", analytic_basev1.SortType_SORT_TYPE_DESC, window(6, 0))
	bcaID := uint64(financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA)
	cashID := uint64(financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_CASH)

	if ids := providers.GetKeys().GetIds().GetIds(); len(ids) != 2 || ids[0] != bcaID || ids[1] != cashID {
		t.Fatalf("providers = %v", ids)
	}

	cashRow := fill(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_PROVIDER, idKeys(cashID), window(6, 0)).GetMetricDatas()[0].GetChangesById().GetItems()[cashID]
	if cashRow.GetClosingBalance() != 280_000 {
		t.Fatalf("cash = %+v", cashRow)
	}
}

// every-team-reads-its-own-finance: another team reads nothing of this team's — not by its scope, not by naming the
// account in the filter.
func TestMetric_AnotherTeamReadsNothing(t *testing.T) {
	b := book(t)

	theirs := headline(t, b.svc, teamB, window(30, 0))
	if theirs.GetClosingBalance() != 7_777 {
		t.Fatalf("team B = %+v", theirs)
	}

	named := headline(t, b.svc, teamB, window(30, 0), accountsFilter(b.ops, b.kas))
	if named.GetClosingBalance() != 0 || named.GetChange() != 0 || named.GetOpeningBalance() != 0 {
		t.Fatalf("team B naming team A's accounts read %+v", named)
	}

	keys := search(t, b.svc, teamB, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, metricChanges, "change", analytic_basev1.SortType_SORT_TYPE_DESC, window(30, 0), accountsFilter(b.ops))
	if len(keys.GetKeys().GetIds().GetIds()) != 0 {
		t.Fatalf("team B ranked team A's account: %v", keys.GetKeys().GetIds().GetIds())
	}

	asked := fill(t, b.svc, teamB, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, idKeys(b.ops), window(30, 0)).GetMetricDatas()[0].GetChangesById().GetItems()[b.ops]
	if asked.GetClosingBalance() != 0 || asked.GetChange() != 0 {
		t.Fatalf("team B filled team A's account: %+v", asked)
	}
}

// every-team-reads-its-own-finance: a warehouse has accounts and reads its own — through the same two reads, with the
// warehouse roles on both policies.
func TestMetric_AWarehouseReadsItsOwnAccounts(t *testing.T) {
	b := book(t)

	ranked := search(t, b.svc, teamW, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, metricChanges, "closing_balance", analytic_basev1.SortType_SORT_TYPE_DESC, window(30, 0))
	if ids := ranked.GetKeys().GetIds().GetIds(); len(ids) != 1 || ids[0] != b.warehouse {
		t.Fatalf("warehouse keys = %v", ids)
	}

	head := headline(t, b.svc, teamW, window(30, 0))
	if head.GetAccountOpening() != 250_000 || head.GetCapital() != 10_000 || head.GetClosingBalance() != 260_000 {
		t.Fatalf("warehouse = %+v", head)
	}

	for _, request := range []string{"warehouse.financial_account.v1.MetricSearchRequest", "warehouse.financial_account.v1.MetricDataRequest"} {
		roles := policyRoles(t, request)
		for _, want := range []string{"ROLE_WAREHOUSE_OWNER", "ROLE_WAREHOUSE_ADMIN", "ROLE_WAREHOUSE_STAFF", "ROLE_SELLING_OWNER", "ROLE_SELLING_ADMIN", "ROLE_SELLING_CS", "ROLE_ROOT", "ROLE_ADMINISTRATOR"} {
			if !roles[want] {
				t.Fatalf("%s lacks %s: %v", request, want, roles)
			}
		}
	}
}

// a-metric-reads-at-most-a-year, and the filters a metric does not list.
func TestMetric_RefusesWhatItCannotRead(t *testing.T) {
	b := book(t)

	cases := map[string]*financial_accountv1.MetricDataRequest{
		"367 days": {TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, Filters: []*analytic_basev1.FilterItem{window(366, 0)}, MetricIds: []string{metricChanges}},
		"no range": {TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, MetricIds: []string{metricChanges}},
		"a shop filter": {TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, MetricIds: []string{metricChanges}, Filters: []*analytic_basev1.FilterItem{
			window(6, 0), {F: &analytic_basev1.FilterItem_ShopFilter{ShopFilter: &analytic_basev1.ShopFilter{ShopId: 501}}},
		}},
		"another service's metric": {TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, Filters: []*analytic_basev1.FilterItem{window(6, 0)}, MetricIds: []string{"metrics/orders"}},
		"a shop group":             {TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SHOP, Filters: []*analytic_basev1.FilterItem{window(6, 0)}, Keys: idKeys(1), MetricIds: []string{metricTypes}},
	}

	for name, req := range cases {
		_, err := b.svc.MetricData(asAni(), connect.NewRequest(req))
		if connectCode(t, err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: %v", name, err)
		}
	}
}
