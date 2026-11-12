//go:build perfaudit

// Performance audit for THE FOUR INVENTORY METRICS (the audit-rpc-performance skill): MetricSearch and MetricData over
// Restock, Returned stock, Transfer and Ready stock, against a busy year:
//
//	inventory_stock_daily_changes  ≈ 1 460 000   4 000 rows a day × 365 — 20 warehouses (5…24) × 30 sellers (100…129)
//	                                              × 10 000 products × 25 suppliers, half the rows orders; per warehouse
//	                                              12.5 restock rows a day (≈ 4 560 a year), as many of each other type
//	inventory_door_daily_reports      18 250     50 a day
//	batches                          200 000     with units — 10 000 per warehouse, ≈ 6 700 per seller
//	warehouse_transfers                2 000     over the year, 2 out-leg rows each; 5 % open, 5 % cancelled
//
// Gudang 5 is one warehouse of twenty, seller 100 one of thirty.
//
//	go test -tags perfaudit -p 1 -run TestPerf_InventoryMetrics -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func perfStockReportBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		// A year of change rows: types by (g / 20) % 16, so every warehouse has every type — 8 in 16 orders (out),
		// restock / transfer_in / return / found in, the rest out, a revaluation value only.
		`INSERT INTO inventory_stock_daily_changes
		     (day, warehouse_id, team_id, product_id, supplier_id, change_type, change_count, change_value)
		 SELECT CURRENT_DATE - d, 5 + (g % 20), 100 + (g % 30), 1000 + ((g * 7 + d) % 10000), g % 25, ty,
		        CASE WHEN ty IN ('restock', 'transfer_in', 'return', 'found') THEN 5 + g % 20
		             WHEN ty = 'revaluation' THEN 0 ELSE -(1 + g % 3) END,
		        CASE WHEN ty IN ('restock', 'transfer_in', 'return', 'found') THEN (5 + g % 20) * 15000.0
		             WHEN ty = 'revaluation' THEN 2500.0 ELSE -(1 + g % 3) * 15000.0 END
		 FROM generate_series(0, 364) d CROSS JOIN generate_series(1, 4000) g
		 CROSS JOIN LATERAL (SELECT (ARRAY['order','order','order','order','order','order','order','order','restock',
		     'transfer_out','transfer_in','return','sample','lost','found','revaluation'])[1 + ((g / 20) % 16)] AS ty) t
		 ON CONFLICT DO NOTHING`,

		`INSERT INTO inventory_door_daily_reports
		     (day, warehouse_id, team_id, product_id, supplier_id, source, broken_count, missing_count)
		 SELECT CURRENT_DATE - d, 5 + (g % 20), 100 + (g % 30), 1000 + ((g * 3 + d) % 10000), g % 25,
		        CASE WHEN g % 2 = 0 THEN 'restock' ELSE 'return' END, g % 3, (g + 1) % 2
		 FROM generate_series(0, 364) d CROSS JOIN generate_series(1, 50) g
		 ON CONFLICT DO NOTHING`,

		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, description)
		 SELECT 5 + (g % 20), 100 + (g % 30), 'restock', 'perf-ready' FROM generate_series(1, 20000) g`,

		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, supplier_id, price_unit, stock_count,
		                      stock_valuation, init_stock_count, init_stock_valuation)
		 SELECT t.warehouse_id, t.team_id, 1000 + ((t.id * 10 + k) % 10000), t.id, (t.id + k) % 25, 15000, 1 + k,
		        (1 + k) * 15000, 1 + k, (1 + k) * 15000
		 FROM inventory_transactions t CROSS JOIN generate_series(0, 9) k WHERE t.description = 'perf-ready'`,

		// 2 000 transfers over the year from warehouse w to w + 1, each with its out-leg transaction.
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, description, created_at)
		 SELECT 5 + (g % 19), 100 + (g % 30), 'transfer_out', 'perf-transfer-' || g, NOW() - ((g % 365) || ' days')::interval
		 FROM generate_series(1, 2000) g`,

		`INSERT INTO warehouse_transfers (team_id, from_warehouse_id, to_warehouse_id, status, outbound_transaction_id,
		                                  created_at, accepted_at, cancelled_at)
		 SELECT t.team_id, t.warehouse_id, t.warehouse_id + 1,
		        CASE WHEN g % 20 = 0 THEN 'shipped' WHEN g % 20 = 1 THEN 'cancel' ELSE 'accepted' END, t.id, t.created_at,
		        CASE WHEN g % 20 > 1 THEN t.created_at + ((2 + g % 3) || ' days')::interval END,
		        CASE WHEN g % 20 = 1 THEN t.created_at + interval '1 day' END
		 FROM inventory_transactions t CROSS JOIN LATERAL (SELECT substring(t.description from 15)::int AS g) n
		 WHERE t.description LIKE 'perf-transfer-%'`,

		`INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, created_at)
		 SELECT t.warehouse_id, t.team_id, b.id, t.id, 'transfer_out', -2, -30000, 0, 0, 15000, t.created_at
		 FROM inventory_transactions t
		 CROSS JOIN LATERAL (SELECT id FROM batches WHERE warehouse_id = t.warehouse_id ORDER BY id LIMIT 2) b
		 WHERE t.description LIKE 'perf-transfer-%'`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("background: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"inventory_stock_daily_changes", "inventory_door_daily_reports", "inventory_transactions",
		"batches", "warehouse_transfers", "batch_logs"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

func TestPerf_InventoryMetrics(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfStockReportBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil)

	today := time.Now().In(metricWIB)
	window := func(from, to int) []*analytic_basev1.FilterItem {
		return []*analytic_basev1.FilterItem{windowOf(today.AddDate(0, 0, -from).Format("2006-01-02"),
			today.AddDate(0, 0, -to).Format("2006-01-02"))}
	}

	warehouse := asRole(1, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)
	seller := asRole(1, role_basev1.Role_ROLE_SELLING_OWNER)
	root := asRole(1, role_basev1.Role_ROLE_ROOT)

	search := func(metric, field string, team uint64, group analytic_basev1.GroupType, from, to int) func(int) error {
		ctx := seller
		if team == otWarehouse {
			ctx = warehouse
		} else if team == 1 {
			ctx = root
		}

		return func(int) error {
			_, err := svc.MetricSearch(ctx, connect.NewRequest(&inventoryv1.MetricSearchRequest{
				TeamId: team, GroupBy: group, Filters: window(from, to),
				Sort: &analytic_basev1.MetricSort{MetricId: metric, Field: field},
				Page: &analytic_basev1.PaginationFilter{Limit: 20},
			}))

			return err
		}
	}

	data := func(metric string, team uint64, group analytic_basev1.GroupType, from, to int, keys *analytic_basev1.MetricKeys) func(int) error {
		ctx := seller
		if team == otWarehouse {
			ctx = warehouse
		} else if team == 1 {
			ctx = root
		}

		return func(int) error {
			_, err := svc.MetricData(ctx, connect.NewRequest(&inventoryv1.MetricDataRequest{
				TeamId: team, GroupBy: group, Filters: window(from, to), Keys: keys, MetricIds: []string{metric},
			}))

			return err
		}
	}

	products := make([]uint64, 0, 20)
	for i := range 20 {
		products = append(products, 1000+uint64(i*37))
	}

	days := make([]string, 0, 30)
	for d := range 30 {
		days = append(days, today.AddDate(0, 0, -d).Format("2006-01-02"))
	}

	months := make([]string, 0, 12)
	for m := range 12 {
		first := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -m, 0)
		months = append(months, first.Format("2006-01-02"))
	}

	byProduct := ids(products...)
	byDay := dayKeys(days...)
	byMonth := dayKeys(months...)

	const (
		summary = analytic_basev1.GroupType_GROUP_TYPE_SUMMARY
		product = analytic_basev1.GroupType_GROUP_TYPE_PRODUCT
		daily   = analytic_basev1.GroupType_GROUP_TYPE_DAILY
		monthly = analytic_basev1.GroupType_GROUP_TYPE_MONTHLY
	)

	for _, m := range []struct{ id, field string }{{restockMetricID, "accepted_count"}, {returnMetricID, "back_count"}} {
		perfRun(t, db, probe, m.id+" search warehouse product-365d", 20, search(m.id, m.field, otWarehouse, product, 364, 0))
		perfRun(t, db, probe, m.id+" search seller daily-30d", 30, search(m.id, m.field, 100, daily, 29, 0))
		perfRun(t, db, probe, m.id+" data seller product-365d", 20, data(m.id, 100, product, 364, 0, byProduct))
		perfRun(t, db, probe, m.id+" data root summary-365d", 1, data(m.id, 1, summary, 364, 0, nil))
	}

	perfRun(t, db, probe, "transfer search warehouse daily-30d by in transit", 30,
		search(transferMetricID, "in_transit_count", otWarehouse, daily, 29, 0))
	perfRun(t, db, probe, "transfer search seller product-365d", 20, search(transferMetricID, "sent_count", 100, product, 364, 0))
	perfRun(t, db, probe, "transfer search warehouse product-365d", 20, search(transferMetricID, "received_count", otWarehouse, product, 364, 0))
	perfRun(t, db, probe, "transfer data seller monthly-365d", 12, data(transferMetricID, 100, monthly, 364, 0, byMonth))
	perfRun(t, db, probe, "transfer data root summary-365d", 1, data(transferMetricID, 1, summary, 364, 0, nil))

	perfRun(t, db, probe, "ready search warehouse product (10 000 held)", 20, search(readyMetricID, "on_hand_value", otWarehouse, product, 364, 0))
	perfRun(t, db, probe, "ready data warehouse daily-30d", 30, data(readyMetricID, otWarehouse, daily, 29, 0, byDay))
	perfRun(t, db, probe, "ready data seller monthly-365d", 12, data(readyMetricID, 100, monthly, 364, 0, byMonth))
	perfRun(t, db, probe, "ready data seller product at 180 days ago", 20, data(readyMetricID, 100, product, 364, 180, byProduct))
	perfRun(t, db, probe, "ready data root summary-365d", 1, data(readyMetricID, 1, summary, 364, 0, nil))
	perfRun(t, db, probe, "ready search root daily-365d", 20, search(readyMetricID, "on_hand_count", 1, daily, 364, 0))
}
