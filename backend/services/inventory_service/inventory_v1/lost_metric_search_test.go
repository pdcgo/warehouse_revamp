package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RANKING LOST STOCK (lost_metric_search.go) on lostBook's losses: Kaos Hitam 8 (Rp 84.000), Kaos Polos 1 (Rp 20.000).

func lostSearch(
	f *opnameFixture,
	team uint64,
	group analytic_basev1.GroupType,
	field string,
	order analytic_basev1.SortType,
	offset, limit int32,
) (*inventoryv1.MetricSearchResponse, error) {
	res, err := f.svc.MetricSearch(ctxUser(1), connect.NewRequest(&inventoryv1.MetricSearchRequest{
		TeamId: team, GroupBy: group, Filters: []*analytic_basev1.FilterItem{lostWindow()},
		Sort: &analytic_basev1.MetricSort{MetricId: lostMetricID, Field: field, SortType: order},
		Page: &analytic_basev1.PaginationFilter{Offset: offset, Limit: limit},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// Ranked by either field, a page at a time, saying whether another follows; a warehouse may rank by the amount
// (a-warehouse-sees-its-lost-amount).
func TestMetricSearch_RanksAPageAndSaysWhetherAnotherFollows(t *testing.T) {
	f := lostBook(t)

	first, err := lostSearch(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, "lost_amount",
		analytic_basev1.SortType_SORT_TYPE_DESC, 0, 1)
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	if got := first.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{otKaosHitam}) || !first.GetHasNext() {
		t.Fatalf("page 1 = %v, has_next %v — want Kaos Hitam, and another page", got, first.GetHasNext())
	}

	second, err := lostSearch(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, "lost_amount",
		analytic_basev1.SortType_SORT_TYPE_DESC, 1, 1)
	if err != nil {
		t.Fatalf("search page 2: %v", err)
	}

	if got := second.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{otKaosPolos}) || second.GetHasNext() {
		t.Fatalf("page 2 = %v, has_next %v — want Kaos Polos, the last", got, second.GetHasNext())
	}

	asc, err := lostSearch(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_TEAM, "lost_count",
		analytic_basev1.SortType_SORT_TYPE_ASC, 0, 10)
	if err != nil {
		t.Fatalf("search sellers: %v", err)
	}

	if got := asc.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{otSinar, otMelati}) {
		t.Fatalf("sellers by units ASC = %v, want Sinar then Melati", got)
	}

	wh, err := lostSearch(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE, "lost_count",
		analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search warehouses: %v", err)
	}

	if got := wh.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{otWarehouse}) {
		t.Fatalf("warehouses = %v, want Gudang 5", got)
	}

	days, err := lostSearch(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_DAILY, "lost_count",
		analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search days: %v", err)
	}

	if got := days.GetKeys().GetDays().GetDays(); !slices.Equal(got, []string{lostToday()}) {
		t.Fatalf("days = %v, want today only", got)
	}
}

// The supplier group leaves the unnamed supplier (0) out — a key nobody could fill; the seller owning the stock sees
// only its own keys; another team none.
func TestMetricSearch_SupplierZeroIsLeftOutAndAStrangerGetsNoKeys(t *testing.T) {
	f := lostBook(t)

	sup, err := lostSearch(f, otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER, "lost_count",
		analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search suppliers: %v", err)
	}

	if got := sup.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{lostSupplier}) {
		t.Fatalf("suppliers = %v, want 61 only", got)
	}

	sinar, err := lostSearch(f, otSinar, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, "lost_count",
		analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search as Sinar: %v", err)
	}

	if got := sinar.GetKeys().GetIds().GetIds(); !slices.Equal(got, []uint64{otKaosPolos}) {
		t.Fatalf("Sinar's products = %v, want Kaos Polos only", got)
	}

	stranger, err := lostSearch(f, lostStranger, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, "lost_count",
		analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10)
	if err != nil {
		t.Fatalf("search as a stranger: %v", err)
	}

	if got := stranger.GetKeys().GetIds().GetIds(); len(got) != 0 || stranger.GetHasNext() {
		t.Fatalf("a stranger's keys = %v, want none", got)
	}
}

// Refused: another metric, an unsortable field, a SUMMARY search, a group the metric lacks (shop).
func TestMetricSearch_Refusals(t *testing.T) {
	f := opnameStocked(t)

	cases := []struct {
		name  string
		group analytic_basev1.GroupType
		sort  *analytic_basev1.MetricSort
	}{
		{"another metric", analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, &analytic_basev1.MetricSort{MetricId: "metrics/orders/created", Field: "lost_count"}},
		{"no such field", analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, &analytic_basev1.MetricSort{MetricId: lostMetricID, Field: "found_count"}},
		{"a shop group", analytic_basev1.GroupType_GROUP_TYPE_SHOP, &analytic_basev1.MetricSort{MetricId: lostMetricID, Field: "lost_count"}},
		{"a summary", analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, &analytic_basev1.MetricSort{MetricId: lostMetricID, Field: "lost_count"}},
	}

	for _, c := range cases {
		_, err := f.svc.MetricSearch(ctxUser(1), connect.NewRequest(&inventoryv1.MetricSearchRequest{
			TeamId: otWarehouse, GroupBy: c.group, Filters: []*analytic_basev1.FilterItem{lostWindow()}, Sort: c.sort,
			Page: &analytic_basev1.PaginationFilter{Limit: 10},
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: %v, want InvalidArgument", c.name, err)
		}
	}
}
