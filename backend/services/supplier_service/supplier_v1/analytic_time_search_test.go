package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

func timeSearch(
	t *testing.T,
	svc *supplier_v1.Service,
	timeframe supplierv1.AnalyticTimeframe,
	filter *supplierv1.AnalyticTimeSearchFilter,
	sort commonv1.CommonSortType,
	pg *commonv1.CommonPagination,
) *supplierv1.AnalyticTimeSearchResponse {
	t.Helper()

	resp, err := svc.AnalyticTimeSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticTimeSearchRequest{
		TeamId: sellingB, SupplierId: 31, Timeframe: timeframe, Filter: filter, SortType: sort, Page: pg,
	}))
	if err != nil {
		t.Fatalf("AnalyticTimeSearch: %v", err)
	}

	return resp.Msg
}

// seedThreeDays folds supplier 31's accepts on the 1st, the 3rd and 2026-11-02, by two teams — and one of supplier 32's
// on the 1st, which no read of 31 may count.
func seedThreeDays(t *testing.T, svc *supplier_v1.Service) {
	t.Helper()

	fold(t, svc, accept(1, sellingA, 31, "2026-10-01", line{product: 100, ordered: 10, total: 10000, accepted: 8, broken: 2}))
	fold(t, svc, accept(2, sellingB, 31, "2026-10-03", line{product: 900, ordered: 5, total: 5000, accepted: 4, lost: 1}))
	fold(t, svc, accept(3, sellingA, 31, "2026-11-02", line{product: 100, ordered: 2, total: 2000, accepted: 2}))
	fold(t, svc, accept(4, sellingA, 32, "2026-10-01", line{product: 100, ordered: 99, total: 99000, accepted: 99}))
}

// Every day of the window is a point, a quiet one included — and another team's supplier reads its figures, every
// team's restocks counted (every-selling-team-sees-every-teams-figures). The total is the WHOLE window.
func TestAnalyticTimeSearch_EveryDayIsAPointAndTheTotalIsTheWindow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedThreeDays(t, svc)

	got := timeSearch(t, svc, supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY,
		&supplierv1.AnalyticTimeSearchFilter{DateRange: dateRange("2026-10-01", "2026-10-03")},
		commonv1.CommonSortType_COMMON_SORT_TYPE_UNSPECIFIED, page(1, 2))

	if got.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("%d points, want 3 — the quiet 2nd too", got.GetPageInfo().GetTotalItems())
	}

	days := []string{}
	for _, p := range got.GetDatas() {
		days = append(days, p.GetAt())
	}

	if len(days) != 2 || days[0] != "2026-10-01" || days[1] != "2026-10-02" {
		t.Fatalf("page 1 = %v, want the 1st and the 2nd, oldest first", days)
	}

	if !proto.Equal(got.GetDatas()[1].GetMetric(), metric(0, 0, 0, 0, 0, 0)) {
		t.Fatalf("the quiet day = %v, want zero", got.GetDatas()[1].GetMetric())
	}

	// The total is all three days, not the page of two.
	if want := metric(12, 12000, 1, 1000, 2, 2000); !proto.Equal(got.GetTotal(), want) {
		t.Fatalf("total = %v, want %v", got.GetTotal(), want)
	}
}

// Monthly is the same figures rolled up, newest first when asked; and one restocking team narrows every number to its
// restocks (the-team-filter-picks-any-selling-team).
func TestAnalyticTimeSearch_MonthlyNewestFirstAndOneTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedThreeDays(t, svc)

	got := timeSearch(t, svc, supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_MONTHLY,
		&supplierv1.AnalyticTimeSearchFilter{DateRange: dateRange("2026-10-01", "2026-11-30"), RestockTeamId: sellingA},
		commonv1.CommonSortType_COMMON_SORT_TYPE_DESC, page(1, 10))

	if len(got.GetDatas()) != 2 || got.GetDatas()[0].GetAt() != "2026-11-01" || got.GetDatas()[1].GetAt() != "2026-10-01" {
		t.Fatalf("buckets = %v, want November then October", got.GetDatas())
	}

	if want := metric(8, 8000, 0, 0, 2, 2000); !proto.Equal(got.GetDatas()[1].GetMetric(), want) {
		t.Fatalf("October for team A = %v, want %v — team B's restock was counted", got.GetDatas()[1].GetMetric(), want)
	}

	if want := metric(10, 10000, 0, 0, 2, 2000); !proto.Equal(got.GetTotal(), want) {
		t.Fatalf("team A's total = %v, want %v", got.GetTotal(), want)
	}
}

// A window too wide for its grain is refused, not truncated — settlement's caps.
func TestAnalyticTimeSearch_RefusesAWindowTooWideForItsGrain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.AnalyticTimeSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticTimeSearchRequest{
		TeamId: sellingA, SupplierId: 31, Timeframe: supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY,
		Filter: &supplierv1.AnalyticTimeSearchFilter{DateRange: dateRange("2025-01-01", "2026-12-31")},
		Page:   page(1, 10),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("two years daily = %v, want InvalidArgument", err)
	}
}
