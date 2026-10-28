package supplier_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

func fill(t *testing.T, svc *supplier_v1.Service, req *supplierv1.MetricDataRequest) *supplierv1.MetricData {
	t.Helper()

	req.TeamId = sellingA
	if req.MetricIds == nil {
		req.MetricIds = []string{suppliersMetric}
	}

	resp, err := svc.MetricData(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("MetricData: %v", err)
	}

	if len(resp.Msg.GetMetricDatas()) != 1 {
		t.Fatalf("one asked metric, %d answers", len(resp.Msg.GetMetricDatas()))
	}

	return resp.Msg.GetMetricDatas()[0]
}

// Every asked key comes back — one with nothing in the scope all zero, never missing
// (the-rows-are-the-keys-step-one-sends) — each with its broken rate computed from its own sums.
func TestMetricData_FillsEveryAskedSupplier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, sinar, _, _ := seedRanking(t, db, svc)

	got := fill(t, svc, &supplierv1.MetricDataRequest{
		GroupBy: bySupplier, Filters: october(), Keys: idKeys(melati.ID, sinar.ID, 999),
	}).GetSupplierById().GetItems()

	want := map[uint64]*supplierv1.SupplierMetric{
		melati.ID: metric(960, 960000, 0, 0, 40, 40000),
		sinar.ID:  metric(117, 117000, 0, 0, 3, 3000),
		999:       metric(0, 0, 0, 0, 0, 0),
	}

	for id, w := range want {
		if !proto.Equal(got[id], w) {
			t.Fatalf("supplier %d = %v, want %v", id, got[id], w)
		}
	}

	if got[melati.ID].GetBrokenRate() != 0.04 {
		t.Fatalf("Melati's broken rate = %v, want 0.04 — 40 of 1.000", got[melati.ID].GetBrokenRate())
	}
}

// The headline is the same metric grouped by SUMMARY (the-headline-is-the-metric-grouped-by-summary) — its rate from
// the summed units, never an average of the suppliers' rates — and the filters scope it as they scope the rows.
func TestMetricData_TheSummaryIsTheHeadline(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, _, _, _ := seedRanking(t, db, svc)

	summary := analytic_basev1.GroupType_GROUP_TYPE_SUMMARY

	all := fill(t, svc, &supplierv1.MetricDataRequest{GroupBy: summary, Filters: october()}).GetSupplierSummary()
	if want := metric(1088, 1578000, 0, 0, 44, 44000); !proto.Equal(all, want) {
		t.Fatalf("every supplier = %v, want %v", all, want)
	}

	one := fill(t, svc, &supplierv1.MetricDataRequest{GroupBy: summary, Filters: october(oneSupplier(melati.ID))}).GetSupplierSummary()
	if want := metric(960, 960000, 0, 0, 40, 40000); !proto.Equal(one, want) {
		t.Fatalf("Melati alone = %v, want %v", one, want)
	}

	teamB := fill(t, svc, &supplierv1.MetricDataRequest{GroupBy: summary, Filters: october(restockTeam(sellingB))}).GetSupplierSummary()
	if want := metric(117, 117000, 0, 0, 3, 3000); !proto.Equal(teamB, want) {
		t.Fatalf("team B = %v, want %v", teamB, want)
	}
}

// A period is keyed by its first day — the Monday of a week, the 1st of a month — and a quiet one comes back zero.
// The window still bounds it: October's month holds only the October days asked for.
func TestMetricData_FillsPeriodsByTheirFirstDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati, _, _, _ := seedRanking(t, db, svc)

	daily := fill(t, svc, &supplierv1.MetricDataRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		Filters: october(oneSupplier(melati.ID)),
		Keys:    dayKeys("2026-10-01", "2026-10-02"),
	}).GetSupplierByDay().GetItems()

	if want := metric(960, 960000, 0, 0, 40, 40000); !proto.Equal(daily["2026-10-01"], want) {
		t.Fatalf("1 October = %v, want %v", daily["2026-10-01"], want)
	}

	if want := metric(0, 0, 0, 0, 0, 0); !proto.Equal(daily["2026-10-02"], want) {
		t.Fatalf("2 October, quiet = %v, want zero", daily["2026-10-02"])
	}

	// 1 October 2026 is a Thursday: its week starts Monday 28 September, and holds the 1st to the 4th.
	weekly := fill(t, svc, &supplierv1.MetricDataRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_WEEKLY, Filters: october(), Keys: dayKeys("2026-09-28"),
	}).GetSupplierByDay().GetItems()

	if want := metric(1088, 1578000, 0, 0, 44, 44000); !proto.Equal(weekly["2026-09-28"], want) {
		t.Fatalf("the week of 28 September = %v, want %v", weekly["2026-09-28"], want)
	}

	monthly := fill(t, svc, &supplierv1.MetricDataRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
		Filters: filters(dateRange("2026-10-02", "2026-10-31")),
		Keys:    dayKeys("2026-10-01"),
	}).GetSupplierByDay().GetItems()

	// From the 2nd: Melati's 1 October is outside the window.
	if want := metric(128, 618000, 0, 0, 4, 4000); !proto.Equal(monthly["2026-10-01"], want) {
		t.Fatalf("October from the 2nd = %v, want %v", monthly["2026-10-01"], want)
	}
}

// A key of the wrong shape, a day that starts no period, keys on a summary, or another service's metric is refused.
func TestMetricData_RefusesKeysThatNameNoRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	cases := []struct {
		name string
		req  *supplierv1.MetricDataRequest
	}{
		{"days for suppliers", &supplierv1.MetricDataRequest{GroupBy: bySupplier, Keys: dayKeys("2026-10-01")}},
		{"ids for days", &supplierv1.MetricDataRequest{GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY, Keys: idKeys(1)}},
		{"a month keyed by its 2nd", &supplierv1.MetricDataRequest{GroupBy: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
			Keys: dayKeys("2026-10-02")}},
		{"a week keyed by a Thursday", &supplierv1.MetricDataRequest{GroupBy: analytic_basev1.GroupType_GROUP_TYPE_WEEKLY,
			Keys: dayKeys("2026-10-01")}},
		{"keys on a summary", &supplierv1.MetricDataRequest{GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
			Keys: idKeys(1)}},
		{"another service's metric", &supplierv1.MetricDataRequest{GroupBy: bySupplier, Keys: idKeys(1),
			MetricIds: []string{"metrics/orders"}}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			c.req.TeamId = sellingA
			c.req.Filters = october()

			if c.req.MetricIds == nil {
				c.req.MetricIds = []string{suppliersMetric}
			}

			_, err := svc.MetricData(context.Background(), connect.NewRequest(c.req))

			var connectErr *connect.Error
			if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
				t.Fatalf("want InvalidArgument, got %v", err)
			}
		})
	}
}
