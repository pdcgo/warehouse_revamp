package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// policyRoles reads a request message's request_policy roles by name.
func policyRoles(t *testing.T, fullName string) map[string]bool {
	t.Helper()

	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(fullName))
	if err != nil {
		t.Fatalf("%s: %v", fullName, err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("%s has no request_policy", fullName)
	}

	out := map[string]bool{}
	for _, role := range policy.GetRoles() {
		out[role.String()] = true
	}

	return out
}

// a-page-says-whether-another-follows, the-key-breaks-every-tie: a page is cut after the rank, says whether another
// follows, and keys with the same figure come key DESC — whichever way the field is sorted.
func TestMetricSearch_PagesAndBreaksTiesByTheKey(t *testing.T) {
	b := book(t)

	page := func(offset int32, dir analytic_basev1.SortType) *financial_accountv1.MetricSearchResponse {
		resp, err := b.svc.MetricSearch(asAni(), connect.NewRequest(&financial_accountv1.MetricSearchRequest{
			TeamId:  teamA,
			GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY,
			Filters: []*analytic_basev1.FilterItem{window(10, 0)},
			Sort:    &analytic_basev1.MetricSort{MetricId: metricChanges, Field: "change", SortType: dir},
			Page:    &analytic_basev1.PaginationFilter{Offset: offset, Limit: 2},
		}))
		if err != nil {
			t.Fatalf("search: %v", err)
		}

		return resp.Msg
	}

	// DESC: the openings day 10 (+1.100.000), the withdrawal day 5 (+500.000).
	first := page(0, analytic_basev1.SortType_SORT_TYPE_DESC)
	if days := first.GetKeys().GetDays().GetDays(); len(days) != 2 || days[0] != day(10) || days[1] != day(5) || !first.GetHasNext() {
		t.Fatalf("first page = %v, has_next %v", days, first.GetHasNext())
	}

	// Then the quiet days (and the transfer's, which nets 0) at 0 — the latest first.
	second := page(2, analytic_basev1.SortType_SORT_TYPE_DESC)
	if days := second.GetKeys().GetDays().GetDays(); days[0] != day(0) || days[1] != day(2) {
		t.Fatalf("second page = %v", days)
	}

	// ASC: the capital out first; the last page says nothing follows.
	asc := page(0, analytic_basev1.SortType_SORT_TYPE_ASC)
	if days := asc.GetKeys().GetDays().GetDays(); days[0] != day(1) {
		t.Fatalf("ascending = %v", days)
	}

	last := page(10, analytic_basev1.SortType_SORT_TYPE_ASC)
	if len(last.GetKeys().GetDays().GetDays()) != 1 || last.GetHasNext() {
		t.Fatalf("last page = %v, has_next %v", last.GetKeys().GetDays().GetDays(), last.GetHasNext())
	}
}

// A search names one of this service's metrics and a field it declares sortable, and never SUMMARY or a group the
// metric does not list.
func TestMetricSearch_RefusesWhatItCannotRank(t *testing.T) {
	b := book(t)

	cases := map[string]*financial_accountv1.MetricSearchRequest{
		"an unknown field": {TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, Filters: []*analytic_basev1.FilterItem{window(6, 0)},
			Sort: &analytic_basev1.MetricSort{MetricId: metricChanges, Field: "balance"}, Page: &analytic_basev1.PaginationFilter{Limit: 10}},
		"changes by change type": {TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_CHANGE_TYPE, Filters: []*analytic_basev1.FilterItem{window(6, 0)},
			Sort: &analytic_basev1.MetricSort{MetricId: metricChanges, Field: "change"}, Page: &analytic_basev1.PaginationFilter{Limit: 10}},
		"a summary": {TeamId: teamA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, Filters: []*analytic_basev1.FilterItem{window(6, 0)},
			Sort: &analytic_basev1.MetricSort{MetricId: metricTypes, Field: "amount"}, Page: &analytic_basev1.PaginationFilter{Limit: 10}},
	}

	for name, req := range cases {
		_, err := b.svc.MetricSearch(asAni(), connect.NewRequest(req))
		if connectCode(t, err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: %v", name, err)
		}
	}
}
