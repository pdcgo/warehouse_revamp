package supplier_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// seedRanking makes three suppliers with figures in October, and a deleted one whose figures are kept
// (a-deleted-supplier-is-kept-for-its-figures). Every unit is Rp 1.000 but Lama's, which are Rp 50.000:
//
//	Melati   1.000 units, 40 broken — Rp   960.000 restocked, 4%     2026-10-01, team A, product 100
//	Sinar      120 units,  3 broken — Rp   117.000,          2,5%   2026-10-02, team B, product 900
//	Kecil        2 units,  1 broken — Rp     1.000,          50%    2026-10-03, team A, product 101 — under 50 units
//	Lama        10 units,  0 broken — Rp   500.000,          0%     2026-10-04, team A, product 102 — under 50 units
func seedRanking(t *testing.T, db *gorm.DB, svc *supplier_v1.Service) (melati, sinar, kecil, lama supplier_service_models.Supplier) {
	t.Helper()

	melati = insertSupplier(t, db, sellingA, "Melati")
	sinar = insertSupplier(t, db, sellingB, "Toko Sinar")
	kecil = insertSupplier(t, db, sellingB, "Toko Kecil")
	lama = insertSupplier(t, db, sellingA, "Lama Tutup")
	softDelete(t, db, &supplier_service_models.Supplier{}, lama.ID)

	fold(t, svc, accept(1, sellingA, melati.ID, "2026-10-01", line{product: 100, ordered: 1000, total: 1000000, accepted: 960, broken: 40}))
	fold(t, svc, accept(2, sellingB, sinar.ID, "2026-10-02", line{product: 900, ordered: 120, total: 120000, accepted: 117, broken: 3}))
	fold(t, svc, accept(3, sellingA, kecil.ID, "2026-10-03", line{product: 101, ordered: 2, total: 2000, accepted: 1, broken: 1}))
	fold(t, svc, accept(4, sellingA, lama.ID, "2026-10-04", line{product: 102, ordered: 10, total: 500000, accepted: 10}))

	return melati, sinar, kecil, lama
}

// `metrics/suppliers` as declared passes the check the server makes at startup — an id, a summary, its required
// filter supported, every sortable field a single number, every number field its stat type
// (san_metric.ValidateDescriptors).
func TestSupplierMetricPassesTheStartupCheck(t *testing.T) {
	err := san_metric.ValidateDescriptors()
	if err != nil {
		t.Fatal(err)
	}

	option := san_metric.OptionOf((&supplierv1.SupplierMetric{}).ProtoReflect().Descriptor())
	if option.GetMetricId() != suppliersMetric {
		t.Fatalf("SupplierMetric declares %q, want %q", option.GetMetricId(), suppliersMetric)
	}
}

func october(more ...*analytic_basev1.FilterItem) []*analytic_basev1.FilterItem {
	return append(filters(dateRange("2026-10-01", "2026-10-31")), more...)
}

func search(t *testing.T, svc *supplier_v1.Service, req *supplierv1.MetricSearchRequest) *supplierv1.MetricSearchResponse {
	t.Helper()

	if req.TeamId == 0 {
		req.TeamId = sellingA
	}

	if req.Page == nil {
		req.Page = window(0, 50)
	}

	resp, err := svc.MetricSearch(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("MetricSearch: %v", err)
	}

	return resp.Msg
}

const (
	bySupplier = analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER
	byProduct  = analytic_basev1.GroupType_GROUP_TYPE_PRODUCT
	desc       = analytic_basev1.SortType_SORT_TYPE_DESC
	asc        = analytic_basev1.SortType_SORT_TYPE_ASC
)

// The Supplier Report's default: by restocked value, the largest first — a deleted supplier ranked like any other.
func TestMetricSearch_RanksSuppliersByValue(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, sinar, kecil, lama := seedRanking(t, db, svc)

	got := search(t, svc, &supplierv1.MetricSearchRequest{
		GroupBy: bySupplier, Filters: october(), Sort: sortBy("restock_valuation", desc),
	})

	if want := []uint64{melati.ID, lama.ID, sinar.ID, kecil.ID}; !slices.Equal(got.GetKeys().GetIds().GetIds(), want) {
		t.Fatalf("by value = %v, want %v", got.GetKeys().GetIds().GetIds(), want)
	}

	if got.GetHasNext() {
		t.Fatal("four suppliers on a page of 50 — no next page")
	}

	ascending := search(t, svc, &supplierv1.MetricSearchRequest{
		GroupBy: bySupplier, Filters: october(), Sort: sortBy("restock_valuation", asc),
	})

	if want := []uint64{kecil.ID, sinar.ID, lama.ID, melati.ID}; !slices.Equal(ascending.GetKeys().GetIds().GetIds(), want) {
		t.Fatalf("ascending = %v, want %v", ascending.GetKeys().GetIds().GetIds(), want)
	}
}

// By broken rate, only a supplier with 50 units is ranked (rate-ranking-needs-50-units — the minimum read off the
// proto's rank_min_sample). Kecil's 50% does not top a list where Melati's 4% stands on a thousand units: the two under
// the minimum follow, in key order — the newest id first (a-rate-ranks-only-above-its-minimum-sample).
func TestMetricSearch_ByBrokenRateRanksOnlyAboveTheMinimum(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, sinar, kecil, lama := seedRanking(t, db, svc)

	got := search(t, svc, &supplierv1.MetricSearchRequest{
		GroupBy: bySupplier, Filters: october(), Sort: sortBy("broken_rate", desc),
	})

	if want := []uint64{melati.ID, sinar.ID, lama.ID, kecil.ID}; !slices.Equal(got.GetKeys().GetIds().GetIds(), want) {
		t.Fatalf("by rate = %v, want %v", got.GetKeys().GetIds().GetIds(), want)
	}
}

// One restocking team narrows the keys to its restocks (the-team-filter-picks-any-selling-team).
func TestMetricSearch_TeamNarrowsTheKeys(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	_, sinar, _, _ := seedRanking(t, db, svc)

	byTeam := search(t, svc, &supplierv1.MetricSearchRequest{
		GroupBy: bySupplier, Filters: october(restockTeam(sellingB)), Sort: sortBy("restock_valuation", desc),
	})
	if !slices.Equal(byTeam.GetKeys().GetIds().GetIds(), []uint64{sinar.ID}) {
		t.Fatalf("team B's restocks rank %v, want only Sinar", byTeam.GetKeys().GetIds().GetIds())
	}
}

// No total: a page says only whether another follows (a-page-says-whether-another-follows), and a page past the end
// is empty rather than an error.
func TestMetricSearch_PagesSayWhetherAnotherFollows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, sinar, kecil, lama := seedRanking(t, db, svc)

	cases := []struct {
		name          string
		offset, limit int32
		want          []uint64
		next          bool
	}{
		{"the first two of four", 0, 2, []uint64{melati.ID, lama.ID}, true},
		{"the last two", 2, 2, []uint64{sinar.ID, kecil.ID}, false},
		{"exactly the four", 0, 4, []uint64{melati.ID, lama.ID, sinar.ID, kecil.ID}, false},
		{"past the end", 4, 2, nil, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := search(t, svc, &supplierv1.MetricSearchRequest{
				GroupBy: bySupplier, Filters: october(), Sort: sortBy("restock_valuation", desc), Page: window(c.offset, c.limit),
			})

			if !slices.Equal(got.GetKeys().GetIds().GetIds(), c.want) || got.GetHasNext() != c.next {
				t.Fatalf("got %v next=%v, want %v next=%v", got.GetKeys().GetIds().GetIds(), got.GetHasNext(), c.want, c.next)
			}
		})
	}
}

// A tie on the sorted field is broken by the key, DESC (the-key-breaks-every-tie) — so a page boundary is stable.
func TestMetricSearch_TheKeyBreaksATie(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := insertSupplier(t, db, sellingA, "Sama Satu")
	second := insertSupplier(t, db, sellingA, "Sama Dua")

	fold(t, svc, accept(1, sellingA, first.ID, "2026-10-01", line{product: 100, ordered: 10, total: 10000, accepted: 10}))
	fold(t, svc, accept(2, sellingA, second.ID, "2026-10-01", line{product: 101, ordered: 10, total: 10000, accepted: 10}))

	for _, direction := range []analytic_basev1.SortType{desc, asc} {
		got := search(t, svc, &supplierv1.MetricSearchRequest{
			GroupBy: bySupplier, Filters: october(), Sort: sortBy("restock_valuation", direction),
		})

		if want := []uint64{second.ID, first.ID}; !slices.Equal(got.GetKeys().GetIds().GetIds(), want) {
			t.Fatalf("%s tie = %v, want the newest id first %v", direction, got.GetKeys().GetIds().GetIds(), want)
		}
	}
}

// One supplier's products — the Statistics tab's By Product: the restocking team's product, the largest value first.
func TestMetricSearch_ProductsOfOneSupplier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melati := insertSupplier(t, db, sellingA, "Melati")
	other := insertSupplier(t, db, sellingA, "Other")

	fold(t, svc, accept(1, sellingA, melati.ID, "2026-10-01",
		line{product: 100, ordered: 10, total: 10000, accepted: 10},
		line{product: 101, ordered: 10, total: 90000, accepted: 10}))
	fold(t, svc, accept(2, sellingB, melati.ID, "2026-10-02", line{product: 900, ordered: 10, total: 50000, accepted: 10}))
	fold(t, svc, accept(3, sellingA, other.ID, "2026-10-02", line{product: 102, ordered: 10, total: 99000, accepted: 10}))

	got := search(t, svc, &supplierv1.MetricSearchRequest{
		GroupBy: byProduct, Filters: october(oneSupplier(melati.ID)), Sort: sortBy("restock_valuation", desc),
	})

	if want := []uint64{101, 900, 100}; !slices.Equal(got.GetKeys().GetIds().GetIds(), want) {
		t.Fatalf("Melati's products = %v, want %v", got.GetKeys().GetIds().GetIds(), want)
	}
}

// A period can be ranked too — keyed by its first day.
func TestMetricSearch_RanksPeriodsByTheirFirstDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedRanking(t, db, svc)

	got := search(t, svc, &supplierv1.MetricSearchRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY, Filters: october(), Sort: sortBy("restock_valuation", desc),
	})

	if want := []string{"2026-10-01", "2026-10-04", "2026-10-02", "2026-10-03"}; !slices.Equal(got.GetKeys().GetDays().GetDays(), want) {
		t.Fatalf("days by value = %v, want %v", got.GetKeys().GetDays().GetDays(), want)
	}

	monthly := search(t, svc, &supplierv1.MetricSearchRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, Filters: october(), Sort: sortBy("restock_count", desc),
	})

	if want := []string{"2026-10-01"}; !slices.Equal(monthly.GetKeys().GetDays().GetDays(), want) {
		t.Fatalf("months = %v, want %v", monthly.GetKeys().GetDays().GetDays(), want)
	}
}

// What the metric does not offer is refused, never guessed: an unknown metric, a field that cannot sort — named by its
// JSON name, or not on the metric — a filter it does not support or sent twice, no window, a backwards window, and a
// summary, which is read and never searched.
func TestMetricSearch_RefusesWhatTheMetricDoesNotOffer(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ProductFilter{
		ProductFilter: &analytic_basev1.ProductFilter{ProductId: 1},
	}}

	cases := []struct {
		name string
		req  *supplierv1.MetricSearchRequest
	}{
		{"another service's metric", &supplierv1.MetricSearchRequest{GroupBy: bySupplier, Filters: october(),
			Sort: &analytic_basev1.MetricSort{MetricId: "metrics/orders", Field: "order_count"}}},
		{"a field by its JSON name", &supplierv1.MetricSearchRequest{GroupBy: bySupplier, Filters: october(),
			Sort: sortBy("restockValuation", desc)}},
		{"a field not on the metric", &supplierv1.MetricSearchRequest{GroupBy: bySupplier, Filters: october(),
			Sort: sortBy("units", desc)}},
		{"a filter it does not support", &supplierv1.MetricSearchRequest{GroupBy: bySupplier, Filters: october(product),
			Sort: sortBy("restock_valuation", desc)}},
		{"a filter sent twice", &supplierv1.MetricSearchRequest{GroupBy: bySupplier, Filters: october(restockTeam(1), restockTeam(2)),
			Sort: sortBy("restock_valuation", desc)}},
		{"no window", &supplierv1.MetricSearchRequest{GroupBy: bySupplier, Filters: filters(restockTeam(1)),
			Sort: sortBy("restock_valuation", desc)}},
		{"a backwards window", &supplierv1.MetricSearchRequest{GroupBy: bySupplier, Filters: filters(dateRange("2026-10-31", "2026-10-01")),
			Sort: sortBy("restock_valuation", desc)}},
		{"a summary", &supplierv1.MetricSearchRequest{GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, Filters: october(),
			Sort: sortBy("restock_valuation", desc)}},
		{"a group it does not offer", &supplierv1.MetricSearchRequest{GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SHOP, Filters: october(),
			Sort: sortBy("restock_valuation", desc)}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			c.req.TeamId = sellingA
			c.req.Page = window(0, 10)

			_, err := svc.MetricSearch(context.Background(), connect.NewRequest(c.req))

			var connectErr *connect.Error
			if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
				t.Fatalf("want InvalidArgument, got %v", err)
			}
		})
	}
}
