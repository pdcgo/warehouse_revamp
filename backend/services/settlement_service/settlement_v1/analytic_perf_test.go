//go:build perfaudit

// Performance audit for settlement's report RPCs and its write (the audit-rpc-performance skill).
//
//	go test -tags perfaudit -run TestPerf_Settlement -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

const (
	perfShops = 200
	perfDays  = 250
)

var perfStart = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// Two teams of 200 shops × 250 days — 100 000 shop-day rows, half of them another team's, so a scope
// filter that misses its index shows up as a scan of rows the caller can never see.
func shopDayRows(teamID uint64, firstShop uint64) []settlement_service_models.ShopSettlementDailyReport {
	rows := make([]settlement_service_models.ShopSettlementDailyReport, 0, perfShops*perfDays)

	for s := uint64(0); s < perfShops; s++ {
		var close int64

		for d := 0; d < perfDays; d++ {
			change := int64(-(int(s)%7+1)*1_000 + d%5*300)
			rows = append(rows, settlement_service_models.ShopSettlementDailyReport{
				Day:    perfStart.AddDate(0, 0, d),
				ShopID: firstShop + s,
				TeamID: teamID,
				SettlementMetricColumns: settlement_service_models.SettlementMetricColumns{
					InitialTotal: -5_000,
					Fund:         change + 5_000,
					Change:       change,
					OpenBalance:  close,
					CloseBalance: close + change,
				},
				LastUpdated: perfStart,
			})
			close += change
		}
	}

	return rows
}

func userDayRows(teamID uint64) []settlement_service_models.UserSettlementDailyReport {
	rows := make([]settlement_service_models.UserSettlementDailyReport, 0, perfShops*perfDays)

	for u := uint64(0); u < perfShops; u++ {
		var close int64

		for d := 0; d < perfDays; d++ {
			change := int64(-1_000)
			rows = append(rows, settlement_service_models.UserSettlementDailyReport{
				Day:    perfStart.AddDate(0, 0, d),
				UserID: 1_000 + u,
				TeamID: teamID,
				SettlementMetricColumns: settlement_service_models.SettlementMetricColumns{
					Change:       change,
					OpenBalance:  close,
					CloseBalance: close + change,
				},
				LastUpdated: perfStart,
			})
			close += change
		}
	}

	return rows
}

func measureRPC(t *testing.T, probe *san_perf.Probe, name string, call func() error) {
	t.Helper()

	err := call() // warm-up
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			err = call()
		})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		walls = append(walls, wall)
		t.Logf("%s wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("%s MEDIAN wall %v, %d queries", name, san_perf.Median(walls), probe.Count())
	probe.Report(t, name)
}

func TestPerf_Settlement(t *testing.T) {
	base := san_testdb.DB(t)

	san_perf.SeedRows(t, base, shopDayRows(team, 1))
	san_perf.SeedRows(t, base, shopDayRows(team+1, 10_001))
	san_perf.SeedRows(t, base, userDayRows(team))

	db, probe := san_perf.Wrap(base)
	svc := settlement_v1.NewService(db, nil, nil)
	ctx := context.Background()

	lastDay := perfStart.AddDate(0, 0, perfDays-1).Format(time.DateOnly)
	monthBack := perfStart.AddDate(0, 0, perfDays-30).Format(time.DateOnly)

	series := func(timeframe settlementv1.AnalyticTimeframe, start string, limit uint32, userID uint64) func() error {
		return func() error {
			_, err := svc.AnalyticTimeSearch(ctx, connect.NewRequest(&settlementv1.AnalyticTimeSearchRequest{
				TeamId:    team,
				Timeframe: timeframe,
				Filter: &settlementv1.AnalyticTimeSearchFilter{
					DateRange: &settlementv1.AnalyticDateRange{StartDate: start, EndDate: lastDay},
					UserId:    userID,
				},
				SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
				Page:     &commonv1.CommonPagination{Page: 1, Limit: limit},
			}))

			return err
		}
	}

	measureRPC(t, probe, "AnalyticTimeSearch daily 30d page20", series(settlementv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY, monthBack, 20, 0))
	measureRPC(t, probe, "AnalyticTimeSearch daily 250d page200", series(settlementv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY, perfStart.Format(time.DateOnly), 200, 0))
	explain(t, base, probe)
	measureRPC(t, probe, "AnalyticTimeSearch monthly 250d", series(settlementv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_MONTHLY, perfStart.Format(time.DateOnly), 20, 0))
	measureRPC(t, probe, "AnalyticTimeSearch user daily 30d", series(settlementv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY, monthBack, 20, 1_000))

	group := func(groupType settlementv1.AnalyticGroupType, limit uint32) func() error {
		return func() error {
			_, err := svc.AnalyticGroupSearch(ctx, connect.NewRequest(&settlementv1.AnalyticGroupSearchRequest{
				TeamId: team,
				Filter: &settlementv1.AnalyticGroupFilter{
					DateRange: &settlementv1.AnalyticDateRange{StartDate: monthBack, EndDate: lastDay},
					GroupType: groupType,
				},
				Page: &commonv1.CommonPagination{Page: 1, Limit: limit},
			}))

			return err
		}
	}

	measureRPC(t, probe, "AnalyticGroupSearch shop page20", group(settlementv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_SHOP, 20))
	measureRPC(t, probe, "AnalyticGroupSearch shop page200", group(settlementv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_SHOP, 200))
	explain(t, base, probe)
	measureRPC(t, probe, "AnalyticGroupSearch user page20", group(settlementv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_USER, 20))

	ids := make([]uint64, 0, 200)
	for s := uint64(1); s <= 200; s++ {
		ids = append(ids, s)
	}

	metric := func(n int) func() error {
		return func() error {
			_, err := svc.AnalyticGroupMetric(ctx, connect.NewRequest(&settlementv1.AnalyticGroupMetricRequest{
				TeamId: team,
				Filter: &settlementv1.AnalyticGroupFilter{
					DateRange: &settlementv1.AnalyticDateRange{StartDate: monthBack, EndDate: lastDay},
					GroupType: settlementv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_SHOP,
				},
				Ids: ids[:n],
			}))

			return err
		}
	}

	measureRPC(t, probe, "AnalyticGroupMetric 20 ids", metric(20))
	measureRPC(t, probe, "AnalyticGroupMetric 200 ids", metric(200))
	explain(t, base, probe)
}

// TestPerf_SettlementPost measures the write against a 50 000-row log.
func TestPerf_SettlementPost(t *testing.T) {
	base := san_testdb.DB(t)

	logs := make([]settlement_service_models.SettlementLog, 0, 50_000)
	for i := 0; i < 50_000; i++ {
		orderID := uint64(100_000 + i%10_000)
		logs = append(logs, settlement_service_models.SettlementLog{
			OrderID:        &orderID,
			ShopID:         shop,
			TeamID:         team,
			SourceType:     "exporter",
			SettlementType: "fund",
			Change:         1_000,
			Balance:        1_000,
			UniqueID:       fmt.Sprintf("seed-%d", i),
			OccurredOn:     perfStart,
			PostedOn:       perfStart,
		})
	}

	san_perf.SeedRows(t, base, logs)

	db, probe := san_perf.Wrap(base)
	svc := settlement_v1.NewService(db, nil, nil)

	n := 0

	measureRPC(t, probe, "SettlementPost", func() error {
		n++
		_, err := svc.PostEntry(context.Background(), settlement_v1.PostInput{
			TeamID:         team,
			ShopID:         shop,
			OrderID:        order,
			UniqueID:       fmt.Sprintf("perf-%d", n),
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_EXPORTER,
			Change:         1_000,
			OccurredOn:     "2026-08-28",
		})

		return err
	})
}

// explain runs EXPLAIN (ANALYZE, BUFFERS) on every distinct query of the last measured call — on the
// test's own transaction, where the seed rows are.
func explain(t *testing.T, db *gorm.DB, probe *san_perf.Probe) {
	t.Helper()

	seen := map[string]bool{}

	for _, q := range probe.Queries() {
		key := strings.TrimSpace(q.SQL)
		if seen[key] {
			continue
		}

		seen[key] = true

		san_perf.Explain(t, db, q.SQL)
	}
}
