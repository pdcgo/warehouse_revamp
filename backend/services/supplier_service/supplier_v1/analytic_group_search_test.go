package supplier_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

func rank(
	t *testing.T,
	svc *supplier_v1.Service,
	sort supplierv1.AnalyticGroupSort,
	filter *supplierv1.AnalyticGroupFilter,
) *supplierv1.AnalyticGroupSearchResponse {
	t.Helper()

	resp, err := svc.AnalyticGroupSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticGroupSearchRequest{
		TeamId: sellingA, Filter: filter, Sort: sort, Page: page(1, 50),
	}))
	if err != nil {
		t.Fatalf("AnalyticGroupSearch: %v", err)
	}

	return resp.Msg
}

// seedRanking makes three suppliers with figures in October:
//
//	Melati   1.000 units, 40 broken — Rp 1.000.000 restocked, 4% broken
//	Sinar      120 units,  3 broken — Rp   117.000,          2,5%
//	Kecil        2 units,  1 broken — Rp     1.000,          50%  — under the 50-unit minimum
//
// and a deleted one, Lama, whose figures are kept (a-deleted-supplier-is-kept-for-its-figures).
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

func october() *supplierv1.AnalyticGroupFilter {
	return &supplierv1.AnalyticGroupFilter{DateRange: dateRange("2026-10-01", "2026-10-31")}
}

// By restocked value, the largest first — a deleted supplier with figures ranked like any other — and the headline is
// every ranked supplier together.
func TestAnalyticGroupSearch_ByValueWithTheDeletedAndTheTotal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, sinar, kecil, lama := seedRanking(t, db, svc)

	got := rank(t, svc, supplierv1.AnalyticGroupSort_ANALYTIC_GROUP_SORT_RESTOCK_VALUATION, october())

	if want := []uint64{melati.ID, lama.ID, sinar.ID, kecil.ID}; !slices.Equal(got.GetIds(), want) {
		t.Fatalf("by value = %v, want %v", got.GetIds(), want)
	}

	if got.GetPageInfo().GetTotalItems() != 4 {
		t.Fatalf("total items = %d, want 4", got.GetPageInfo().GetTotalItems())
	}

	if want := metric(1088, 1578000, 0, 0, 44, 44000); !proto.Equal(got.GetTotal(), want) {
		t.Fatalf("headline = %v, want %v", got.GetTotal(), want)
	}

	if got.GetRateMinUnits() != 50 {
		t.Fatalf("rate_min_units = %d, want 50", got.GetRateMinUnits())
	}
}

// By broken rate, a supplier needs 50 units to be rated against the others (rate-ranking-needs-50-units): Toko Kecil's
// 50% does not top a list where Melati's 4% stands on a thousand units — it follows, after every rated supplier.
func TestAnalyticGroupSearch_ByRateNeedsFiftyUnits(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, sinar, kecil, lama := seedRanking(t, db, svc)

	got := rank(t, svc, supplierv1.AnalyticGroupSort_ANALYTIC_GROUP_SORT_BROKEN_RATE, october())

	// Rated: Melati 4%, Sinar 2,5%. Under the minimum: Kecil 50%, Lama 0% (10 units).
	if want := []uint64{melati.ID, sinar.ID, kecil.ID, lama.ID}; !slices.Equal(got.GetIds(), want) {
		t.Fatalf("by rate = %v, want %v", got.GetIds(), want)
	}
}

// The search finds suppliers as SupplierList does — the name, the address, a live store's name
// (the-supplier-report-searches-like-discover) — and the headline is what it found. One restocking team narrows it.
func TestAnalyticGroupSearch_SearchAndTeamNarrowTheRankingAndTheHeadline(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, sinar, _, _ := seedRanking(t, db, svc)

	insertChannel(t, db, melati.ID, "shopee", "Grosir Bandung")

	byStore := rank(t, svc, supplierv1.AnalyticGroupSort_ANALYTIC_GROUP_SORT_RESTOCK_VALUATION,
		&supplierv1.AnalyticGroupFilter{DateRange: october().GetDateRange(), Q: "bandung"})
	if !slices.Equal(byStore.GetIds(), []uint64{melati.ID}) {
		t.Fatalf("q=bandung = %v, want Melati through its store", byStore.GetIds())
	}

	if want := metric(960, 960000, 0, 0, 40, 40000); !proto.Equal(byStore.GetTotal(), want) {
		t.Fatalf("headline = %v, want only what the search found %v", byStore.GetTotal(), want)
	}

	byTeam := rank(t, svc, supplierv1.AnalyticGroupSort_ANALYTIC_GROUP_SORT_RESTOCK_VALUATION,
		&supplierv1.AnalyticGroupFilter{DateRange: october().GetDateRange(), RestockTeamId: sellingB})
	if !slices.Equal(byTeam.GetIds(), []uint64{sinar.ID}) {
		t.Fatalf("team B's restocks rank %v, want only Sinar", byTeam.GetIds())
	}
}

// A page past the last still answers how many suppliers there are and their headline — the totals ride on the page's
// rows, so with none a second statement asks for them.
func TestAnalyticGroupSearch_APagePastTheEndStillHasTheTotals(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedRanking(t, db, svc)

	resp, err := svc.AnalyticGroupSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticGroupSearchRequest{
		TeamId: sellingA, Filter: october(), Page: page(3, 2),
	}))
	if err != nil {
		t.Fatalf("AnalyticGroupSearch: %v", err)
	}

	if len(resp.Msg.GetIds()) != 0 || resp.Msg.GetPageInfo().GetTotalItems() != 4 {
		t.Fatalf("page 3 of 2 = %v ids, %d total — want none, and 4", resp.Msg.GetIds(), resp.Msg.GetPageInfo().GetTotalItems())
	}

	if want := metric(1088, 1578000, 0, 0, 44, 44000); !proto.Equal(resp.Msg.GetTotal(), want) {
		t.Fatalf("headline = %v, want %v", resp.Msg.GetTotal(), want)
	}
}
