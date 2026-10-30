package settlement_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

func metricSearch(
	svc *settlement_v1.Service,
	group analytic_basev1.GroupType,
	filters []*analytic_basev1.FilterItem,
	metricID, field string,
	sortType analytic_basev1.SortType,
	offset, limit int32,
) (*settlementv1.MetricSearchResponse, error) {
	res, err := svc.MetricSearch(context.Background(), connect.NewRequest(&settlementv1.MetricSearchRequest{
		TeamId:  team,
		GroupBy: group,
		Filters: filters,
		Sort:    &analytic_basev1.MetricSort{MetricId: metricID, Field: field, SortType: sortType},
		Page:    &analytic_basev1.PaginationFilter{Offset: offset, Limit: limit},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// twoShops is the worked example in shop 30, and a 50.000 sale with nothing yet received in shop 31.
func twoShops(t *testing.T, svc *settlement_v1.Service) {
	t.Helper()

	fold(t, svc, workedExample()...)
	fold(t, svc, logPosted(20, "2026-01-02", otherShop, otherOrder, 8, 8,
		settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -50_000))
}

// The default ranking is the Settlement Report's: the LARGEST SHORTFALL first — `position_to_date`, unspecified reads
// DESC. Shop 31 holds 50.000, shop 30 holds 30.000.
func TestMetricSearch_RanksShopsByTheirPosition(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	twoShops(t, svc)

	res, err := metricSearch(svc, analytic_basev1.GroupType_GROUP_TYPE_SHOP,
		[]*analytic_basev1.FilterItem{window("2026-01-02", "2026-01-03")},
		metricSettlement, "position_to_date", analytic_basev1.SortType_SORT_TYPE_UNSPECIFIED, 0, 10)
	if err != nil {
		t.Fatalf("MetricSearch: %v", err)
	}

	if ids := res.GetKeys().GetIds().GetIds(); !slices.Equal(ids, []uint64{otherShop, shop}) || res.GetHasNext() {
		t.Fatalf("ranking = %v (has_next %v), want [%d %d] — the larger shortfall first", ids, res.GetHasNext(), otherShop, shop)
	}
}

// ⚠ A SHOP QUIET IN THE WINDOW STILL RANKS, by the position it carries in — a key is anything with a row up to the
// window's end. The ranking by a movement then ties at zero and the key, DESC, breaks it.
func TestMetricSearch_AQuietShopStillRanksByWhatItCarries(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	twoShops(t, svc)

	quiet := []*analytic_basev1.FilterItem{window("2026-01-10", "2026-01-11")}

	res, err := metricSearch(svc, analytic_basev1.GroupType_GROUP_TYPE_SHOP, quiet,
		metricSettlement, "position_to_date", analytic_basev1.SortType_SORT_TYPE_ASC, 0, 10)
	if err != nil {
		t.Fatalf("MetricSearch: %v", err)
	}

	if ids := res.GetKeys().GetIds().GetIds(); !slices.Equal(ids, []uint64{shop, otherShop}) {
		t.Fatalf("ASC by position = %v, want [%d %d]", ids, shop, otherShop)
	}

	res, err = metricSearch(svc, analytic_basev1.GroupType_GROUP_TYPE_SHOP, quiet,
		metricTypes, "fund", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("MetricSearch by type: %v", err)
	}

	if ids := res.GetKeys().GetIds().GetIds(); !slices.Equal(ids, []uint64{otherShop, shop}) {
		t.Fatalf("by fund, a tie at zero = %v, want [%d %d] — the key DESC breaks it", ids, otherShop, shop)
	}
}

// No total: a page reads limit + 1 and says whether another follows.
func TestMetricSearch_SaysWhetherAnotherPageFollows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	twoShops(t, svc)

	filters := []*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}

	first, err := metricSearch(svc, analytic_basev1.GroupType_GROUP_TYPE_SHOP, filters,
		metricSettlement, "sales", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 1)
	if err != nil {
		t.Fatalf("first page: %v", err)
	}

	second, err := metricSearch(svc, analytic_basev1.GroupType_GROUP_TYPE_SHOP, filters,
		metricSettlement, "sales", analytic_basev1.SortType_SORT_TYPE_DESC, 1, 1)
	if err != nil {
		t.Fatalf("second page: %v", err)
	}

	if ids := first.GetKeys().GetIds().GetIds(); !slices.Equal(ids, []uint64{shop}) || !first.GetHasNext() {
		t.Fatalf("first page = %v has_next %v, want [%d] and another", ids, first.GetHasNext(), shop)
	}

	if ids := second.GetKeys().GetIds().GetIds(); !slices.Equal(ids, []uint64{otherShop}) || second.GetHasNext() {
		t.Fatalf("second page = %v has_next %v, want [%d] and the last", ids, second.GetHasNext(), otherShop)
	}
}

// A time group ranks EVERY period of the window, a quiet one included — 01-04 moved nothing and still holds 30.000.
func TestMetricSearch_ATimeGroupRanksEveryPeriod(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)

	res, err := metricSearch(svc, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")},
		metricSettlement, "position_to_date", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("MetricSearch: %v", err)
	}

	want := []string{"2026-01-02", "2026-01-01", "2026-01-04", "2026-01-03"}
	if days := res.GetKeys().GetDays().GetDays(); !slices.Equal(days, want) {
		t.Fatalf("days by position = %v, want %v — 130.000, 120.000, then the 30.000 tie newest first", days, want)
	}
}

// A person with no one recorded is LEFT OUT of the person group — the contract cannot send 0 back as a key — and still
// counted everywhere else.
func TestMetricSearch_TheUnrecordedPersonIsNoKey(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)
	fold(t, svc, logPosted(40, "2026-01-02", shop, 0, 0, 0,
		settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT, -5_000))

	filters := []*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}

	res, err := metricSearch(svc, analytic_basev1.GroupType_GROUP_TYPE_USER, filters,
		metricSettlement, "position_to_date", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("MetricSearch: %v", err)
	}

	if ids := res.GetKeys().GetIds().GetIds(); !slices.Equal(ids, []uint64{creator}) {
		t.Fatalf("people = %v, want [%d] alone", ids, creator)
	}

	headline := mustData(t, svc, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, filters, metricSettlement)
	if position := headline[0].GetSettlementSummary().GetPositionToDate(); position != 35_000 {
		t.Fatalf("headline position = %d, want 35.000 — the unrecorded row still counts", position)
	}
}

// What the search refuses: a span too long to rank, a field that cannot sort, a summary, and a shop with a person.
func TestMetricSearch_Refuses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	cases := map[string]struct {
		group   analytic_basev1.GroupType
		filters []*analytic_basev1.FilterItem
		field   string
	}{
		"two years, daily": {analytic_basev1.GroupType_GROUP_TYPE_DAILY,
			[]*analytic_basev1.FilterItem{window("2024-01-01", "2026-01-01")}, "sales"},
		"the take rate": {analytic_basev1.GroupType_GROUP_TYPE_SHOP,
			[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}, "take_rate"},
		"a summary": {analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
			[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}, "sales"},
		"by shop, for a person": {analytic_basev1.GroupType_GROUP_TYPE_SHOP,
			[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04"), userFilter(creator)}, "sales"},
		"no window": {analytic_basev1.GroupType_GROUP_TYPE_SHOP, nil, "sales"},
	}

	for name, c := range cases {
		_, err := metricSearch(svc, c.group, c.filters, metricSettlement, c.field,
			analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: got %v, want InvalidArgument", name, err)
		}
	}
}

// Both metrics pass the same startup check every metric does (san_metric.ValidateDescriptors).
func TestSettlementMetrics_PassTheStartupCheck(t *testing.T) {
	err := san_metric.ValidateDescriptors()
	if err != nil {
		t.Fatalf("ValidateDescriptors: %v", err)
	}
}
