package expense_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// RANKING THE EXPENSE METRICS (metric_search.go) on metricBook's entries.

// policyRoles reads a request message's request_policy roles.
func policyRoles(t *testing.T, fullName string) map[role_basev1.Role]bool {
	t.Helper()

	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(fullName))
	if err != nil {
		t.Fatalf("%s: %v", fullName, err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("%s has no request_policy", fullName)
	}

	out := map[role_basev1.Role]bool{}
	for _, role := range policy.GetRoles() {
		out[role] = true
	}

	return out
}

type metricQuery struct {
	team    uint64
	group   analytic_basev1.GroupType
	metric  string
	field   string
	order   analytic_basev1.SortType
	offset  int32
	limit   int32
	filters []*analytic_basev1.FilterItem
}

func (f *metricFixture) search(q metricQuery) (*expensev1.MetricSearchResponse, error) {
	if q.filters == nil {
		q.filters = []*analytic_basev1.FilterItem{october()}
	}

	if q.limit == 0 {
		q.limit = 20
	}

	res, err := f.svc.MetricSearch(context.Background(), connect.NewRequest(&expensev1.MetricSearchRequest{
		TeamId: q.team, GroupBy: q.group, Filters: q.filters,
		Sort: &analytic_basev1.MetricSort{MetricId: q.metric, Field: q.field, SortType: q.order},
		Page: &analytic_basev1.PaginationFilter{Offset: q.offset, Limit: q.limit},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func (f *metricFixture) mustSearch(t *testing.T, q metricQuery) *expensev1.MetricSearchResponse {
	t.Helper()

	res, err := f.search(q)
	if err != nil {
		t.Fatalf("MetricSearch(%+v): %v", q, err)
	}

	return res
}

// Ads expense by shop, by person, a page at a time: ranked by the amount, the key DESC on a tie, saying whether another
// page follows (a-page-says-whether-another-follows, the-key-breaks-every-tie).
func TestMetricSearch_RanksAPageAndSaysWhetherAnotherFollows(t *testing.T) {
	f := metricBook(t)

	shops := f.mustSearch(t, metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SHOP, metric: metricAds, field: "amount"})
	if got := shops.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{adsShop, shopSinar}) || shops.GetHasNext() {
		t.Fatalf("shops by ads = %v (next %v), want 100.000's shop then Sinar's 50.000", got, shops.GetHasNext())
	}

	first := f.mustSearch(t, metricQuery{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_USER, metric: metricAds, field: "amount", limit: 1,
	})
	if got := first.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{userBudi}) || !first.GetHasNext() {
		t.Fatalf("page 1 by person = %v (next %v), want Budi and another page", got, first.GetHasNext())
	}

	// Ascending, Dewi's −450.000 first: a corrector who only corrected is a row.
	asc := f.mustSearch(t, metricQuery{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_USER, metric: metricAds, field: "amount",
		order: analytic_basev1.SortType_SORT_TYPE_ASC,
	})
	if got := asc.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{userDewi, userAni, userBudi}) {
		t.Fatalf("people by ads ASC = %v, want Dewi, Ani, Budi", got)
	}

	// The days with an ad entry, the day sorted DESC by amount: 14 Oct first, the two correction days last.
	days := f.mustSearch(t, metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_DAILY, metric: metricAds, field: "amount"})
	if got := days.GetKeys().GetDays().GetDays(); !slices.Equal(got, []string{"2026-10-14", "2026-10-16", "2026-10-15", "2026-10-17", "2026-10-20"}) {
		t.Fatalf("ad days = %v", got)
	}
}

// Expenses ranks by any kind or the total; its keys are every typed kind's — Ani's payroll makes her the top spender —
// while Ads expense's keys are the ads' own. The stock loss is no key and no day.
func TestMetricSearch_ExpensesRanksByAnyKind(t *testing.T) {
	f := metricBook(t)

	people := f.mustSearch(t, metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_USER, metric: metricExpenses, field: "total"})
	if got := people.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{userAni, userBudi, userDewi}) {
		t.Fatalf("people by total = %v, want Ani (payroll), Budi, Dewi", got)
	}

	payroll := f.mustSearch(t, metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_DAILY, metric: metricExpenses, field: "payroll"})
	if got := payroll.GetKeys().GetDays().GetDays(); got[0] != "2026-10-31" || slices.Contains(got, "2026-10-12") {
		t.Fatalf("days by payroll = %v, want the 31st first and no stock-loss day", got)
	}

	adsDays := f.mustSearch(t, metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_DAILY, metric: metricAds, field: "amount"})
	if slices.Contains(adsDays.GetKeys().GetDays().GetDays(), "2026-10-31") {
		t.Fatalf("Ads expense lists the payroll day: %v", adsDays.GetKeys().GetDays().GetDays())
	}
}

// SELLER AND WAREHOUSE ARE TWO GROUPS (the-warehouse-is-its-own-group): root ranks Melati and Kenanga by Seller and
// Gudang Pusat by Warehouse — a warehouse team is never a Seller key, a seller never a Warehouse key.
func TestMetricSearch_SellerAndWarehouseAreTwoGroups(t *testing.T) {
	f := metricBook(t)

	sellers := f.mustSearch(t, metricQuery{team: 1, group: analytic_basev1.GroupType_GROUP_TYPE_TEAM, metric: metricExpenses, field: "total"})
	if got := sellers.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{teamA, teamB}) {
		t.Fatalf("root by seller = %v, want Melati then Kenanga", got)
	}

	warehouses := f.mustSearch(t, metricQuery{team: 1, group: analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE, metric: metricExpenses, field: "total"})
	if got := warehouses.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{warehouseTeam}) {
		t.Fatalf("root by warehouse = %v, want Gudang Pusat", got)
	}

	// A team reads only its own: Kenanga by seller is itself.
	own := f.mustSearch(t, metricQuery{team: teamB, group: analytic_basev1.GroupType_GROUP_TYPE_TEAM, metric: metricExpenses, field: "total"})
	if got := own.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{teamB}) {
		t.Fatalf("Kenanga by seller = %v, want itself", got)
	}

	// The warehouse by seller is nothing.
	none := f.mustSearch(t, metricQuery{team: warehouseTeam, group: analytic_basev1.GroupType_GROUP_TYPE_TEAM, metric: metricExpenses, field: "total"})
	if got := none.GetKeys().GetIds().GetIds(); len(got) != 0 {
		t.Fatalf("Gudang Pusat by seller = %v, want none", got)
	}
}

// What a search refuses, as InvalidArgument: a sort field the metric does not have (Expenses has no `amount`), Expenses
// by shop, a shop filter on Expenses, another service's metric.
func TestMetricSearch_Refuses(t *testing.T) {
	f := metricBook(t)

	shop := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ShopFilter{ShopFilter: &analytic_basev1.ShopFilter{ShopId: shopSinar}}}

	for _, c := range []struct {
		name string
		q    metricQuery
	}{
		{"Expenses sorted by amount", metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_USER, metric: metricExpenses, field: "amount"}},
		{"Expenses by shop", metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SHOP, metric: metricExpenses, field: "total"}},
		{"a shop on Expenses", metricQuery{
			team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_USER, metric: metricExpenses, field: "total",
			filters: []*analytic_basev1.FilterItem{october(), shop},
		}},
		{"another metric", metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_USER, metric: "metrics/warehouse_fee", field: "amount"}},
		{"a summary", metricQuery{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, metric: metricAds, field: "amount"}},
	} {
		_, err := f.search(c.q)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: %v, want InvalidArgument", c.name, err)
		}
	}
}
