//go:build perfaudit

// Performance audit for RESTOCK BEFORE THE ACCEPT (the-restock-before-the-accept-prototype-is-accepted): Restock now reads
// its door rows' ordered, lost and COD beside the accept's change rows, and every restock create, edit, cancel, lost and
// sign adds a door row — so the door report grows from the accepts' broken / missing alone (50 rows a day in
// TestPerf_InventoryMetrics' busy year) to a row per line per restock write:
//
//	inventory_door_daily_reports   + 219 000   600 restock rows a day × 365 — 20 warehouses × 30 sellers × 10 000
//	                                           products: ordered (an edit or a cancel negative), now and then lost, a
//	                                           COD on a fifth
//
// on top of TestPerf_InventoryMetrics' background. PERF_RESTOCK_OLD_DOOR=1 seeds the old door volume only (the build's
// BEFORE), for the same reads.
//
//	go test -tags perfaudit -p 1 -run TestPerf_RestockMetric -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"os"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func perfRestockDoorVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	err := quiet.Exec(`
INSERT INTO inventory_door_daily_reports
    (day, warehouse_id, team_id, product_id, supplier_id, source, ordered_count, ordered_value, lost_count, lost_value,
     cod_amount)
SELECT CURRENT_DATE - d, 5 + (g % 20), 100 + (g % 30), 1000 + ((g * 11 + d) % 10000), g % 25, 'restock',
       (g % 7) - 1, ((g % 7) - 1) * 15500.0,
       CASE WHEN g % 50 = 0 THEN 1 + g % 5 ELSE 0 END, CASE WHEN g % 50 = 0 THEN (1 + g % 5) * 15500.0 ELSE 0 END,
       CASE WHEN g % 5 = 0 THEN 2500.0 ELSE 0 END
FROM generate_series(0, 364) d CROSS JOIN generate_series(1, 600) g
ON CONFLICT DO NOTHING`).Error
	if err != nil {
		t.Fatalf("restock door volume: %v", err)
	}

	err = quiet.Exec("ANALYZE inventory_door_daily_reports").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
}

func TestPerf_RestockMetric(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfStockReportBackground(t, db)

	if os.Getenv("PERF_RESTOCK_OLD_DOOR") != "1" {
		perfRestockDoorVolume(t, db)
	}

	var doorRows int64
	db.Raw(`SELECT count(*) FROM inventory_door_daily_reports`).Scan(&doorRows)
	t.Logf("door rows: %d", doorRows)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil, nil, nil)

	today := time.Now().In(metricWIB)
	window := func(from, to int) []*analytic_basev1.FilterItem {
		return []*analytic_basev1.FilterItem{windowOf(today.AddDate(0, 0, -from).Format("2006-01-02"),
			today.AddDate(0, 0, -to).Format("2006-01-02"))}
	}

	warehouse := asRole(1, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)
	seller := asRole(1, role_basev1.Role_ROLE_SELLING_OWNER)
	root := asRole(1, role_basev1.Role_ROLE_ROOT)

	ctxOf := func(team uint64) context.Context {
		switch team {
		case otWarehouse:
			return warehouse
		case 1:
			return root
		default:
			return seller
		}
	}

	search := func(field string, team uint64, group analytic_basev1.GroupType, from, to int) func(int) error {
		return func(int) error {
			_, err := searchMetric(svc, ctxOf(team), team, restockMetricID, group, field,
				analytic_basev1.SortType_SORT_TYPE_DESC, 0, 20, window(from, to)...)

			return err
		}
	}

	data := func(team uint64, group analytic_basev1.GroupType, from, to int, keys *analytic_basev1.MetricKeys) func(int) error {
		return func(int) error {
			_, err := readMetric(svc, ctxOf(team), team, restockMetricID, group, keys, window(from, to)...)

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

	const (
		summary = analytic_basev1.GroupType_GROUP_TYPE_SUMMARY
		product = analytic_basev1.GroupType_GROUP_TYPE_PRODUCT
		daily   = analytic_basev1.GroupType_GROUP_TYPE_DAILY
	)

	perfRun(t, db, probe, "restock search warehouse product-365d", 20, search("accepted_count", otWarehouse, product, 364, 0))
	perfRun(t, db, probe, "restock search seller daily-30d", 30, search("accepted_count", 100, daily, 29, 0))
	perfRun(t, db, probe, "restock data seller product-365d", 20, data(100, product, 364, 0, ids(products...)))
	perfRun(t, db, probe, "restock data warehouse daily-30d", 30, data(otWarehouse, daily, 29, 0, dayKeys(days...)))
	perfRun(t, db, probe, "restock data warehouse summary-365d", 1, data(otWarehouse, summary, 364, 0, nil))
	perfRun(t, db, probe, "restock data root summary-365d", 1, data(1, summary, 364, 0, nil))
}
