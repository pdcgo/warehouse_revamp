//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the order metrics — MetricSearch and MetricData over a year
// of `order_daily_reports`.
//
//	go test -tags perfaudit -run TestPerf_OrderMetric -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// perfReportRows is a year of report rows: 365 days × 5 metrics × 55 (seller, shop, warehouse, creator) — ~100 000
// rows over 5 sellers, 20 shops, 3 warehouses and 7 creators.
func perfReportRows() []selling_service_models.OrderDailyReport {
	metrics := []string{"created", "cancelled", "return_created", "return_arrived", "lost_created"}
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	rows := make([]selling_service_models.OrderDailyReport, 0, 365*5*55)

	for d := range 365 {
		for _, metric := range metrics {
			for k := range 55 {
				rows = append(rows, selling_service_models.OrderDailyReport{
					Day:         start.AddDate(0, 0, d),
					Metric:      metric,
					TeamID:      uint64(2 + k%5),
					ShopID:      uint64(100 + k%20),
					WarehouseID: uint64(900 + k%3),
					UserID:      uint64(1 + k%7),
					OrderMetricColumns: selling_service_models.OrderMetricColumns{
						OrderCount: int64(1 + (d+k)%9),
						Total:      float64(50_000 + 137*k),
						MpTotal:    int64(60_000 + 151*k),
					},
					LastUpdated: time.Now(),
				})
			}
		}
	}

	return rows
}

func perfWindow(min, max string) []*analytic_basev1.FilterItem {
	return []*analytic_basev1.FilterItem{{F: &analytic_basev1.FilterItem_DateRangeFilter{
		DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: min, DateMax: max},
	}}}
}

func TestPerf_OrderMetric(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	rows := perfReportRows()
	san_perf.SeedRows(t, db, rows)

	err := db.Exec("ANALYZE order_daily_reports").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	t.Logf("seed: order_daily_reports=%d", len(rows))

	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{900: true})
	ctx := context.Background()

	all := []string{metricCreated, metricCancelled, metricReturnCreated, metricReturnArrived, metricLostCreated}
	shops := &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{
		Ids: []uint64{100, 105, 110, 115, 101, 106, 111, 116},
	}}}

	cases := []struct {
		name string
		run  func() error
	}{
		{"search · seller · by shop · 30 days", func() error {
			_, err := analytic.MetricSearch(ctx, connect.NewRequest(&sellingv1.MetricSearchRequest{
				TeamId: 2, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SHOP, Filters: perfWindow("2026-10-01", "2026-10-30"),
				Sort: &analytic_basev1.MetricSort{MetricId: metricCreated, Field: "created_total"},
				Page: &analytic_basev1.PaginationFilter{Limit: 50},
			}))

			return err
		}},
		{"search · warehouse · by team · a year", func() error {
			_, err := analytic.MetricSearch(ctx, connect.NewRequest(&sellingv1.MetricSearchRequest{
				TeamId: 900, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_TEAM, Filters: perfWindow("2026-01-01", "2026-12-31"),
				Sort: &analytic_basev1.MetricSort{MetricId: metricCreated, Field: "created_count"},
				Page: &analytic_basev1.PaginationFilter{Limit: 50},
			}))

			return err
		}},
		{"search · root · by user · a year", func() error {
			_, err := analytic.MetricSearch(ctx, connect.NewRequest(&sellingv1.MetricSearchRequest{
				TeamId: san_auth.RootTeamID, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_USER,
				Filters: perfWindow("2026-01-01", "2026-12-31"),
				Sort:    &analytic_basev1.MetricSort{MetricId: metricCancelled, Field: "cancel_count"},
				Page:    &analytic_basev1.PaginationFilter{Limit: 50},
			}))

			return err
		}},
		{"data · seller · 8 shops × 5 metrics · a year", func() error {
			_, err := analytic.MetricData(ctx, connect.NewRequest(&sellingv1.MetricDataRequest{
				TeamId: 2, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SHOP, Filters: perfWindow("2026-01-01", "2026-12-31"),
				Keys: shops, MetricIds: all,
			}))

			return err
		}},
		{"data · root · summary × 5 metrics · a year", func() error {
			_, err := analytic.MetricData(ctx, connect.NewRequest(&sellingv1.MetricDataRequest{
				TeamId: san_auth.RootTeamID, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
				Filters: perfWindow("2026-01-01", "2026-12-31"), MetricIds: all,
			}))

			return err
		}},
	}

	for _, c := range cases {
		err := c.run() // warm-up
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = c.run() })
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			_ = dbTime
		}

		t.Logf("%s: MEDIAN wall %v, queries %d", c.name, san_perf.Median(walls), probe.Count())

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
