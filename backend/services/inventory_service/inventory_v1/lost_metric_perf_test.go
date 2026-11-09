//go:build perfaudit

// Performance audit for LOST STOCK (the audit-rpc-performance skill): MetricSearch and MetricData over
// `metrics/inventory/lost`, and the fold on the write path (a Stock Adjust "lost") — against ~220 000 report rows: a
// year of days × 20 warehouses × 30 sellers × products.
//
//	go test -tags perfaudit -p 1 -run TestPerf_LostMetric -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// perfLostBackground writes 600 rows a day for a year: warehouse 5 + (g % 20), seller 100 + (g % 30), product
// 1000 + (g % 400), supplier g % 25 (0 = none) — so Gudang 5 holds a twentieth, each seller a thirtieth.
func perfLostBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	err := quiet.Exec(`
		INSERT INTO inventory_lost_daily_reports (day, warehouse_id, team_id, product_id, supplier_id, lost_count, lost_amount)
		SELECT CURRENT_DATE - d, 5 + (g % 20), 100 + (g % 30), 1000 + ((g * 7 + d) % 400), g % 25, 1 + (g % 3), (1 + (g % 3)) * 15000
		FROM generate_series(0, 364) d CROSS JOIN generate_series(1, 600) g
		ON CONFLICT DO NOTHING`).Error
	if err != nil {
		t.Fatalf("lost background: %v", err)
	}

	err = quiet.Exec("ANALYZE inventory_lost_daily_reports").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
}

func TestPerf_LostMetric(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLostBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil)

	today := time.Now()
	window := func(from int) []*analytic_basev1.FilterItem {
		return []*analytic_basev1.FilterItem{{F: &analytic_basev1.FilterItem_DateRangeFilter{DateRangeFilter: &analytic_basev1.DateRangeFilter{
			DateMin: today.AddDate(0, 0, -from).Format("2006-01-02"), DateMax: today.Format("2006-01-02"),
		}}}}
	}

	search := func(team uint64, group analytic_basev1.GroupType, from int, limit int32) func(int) error {
		return func(int) error {
			_, err := svc.MetricSearch(ctxUser(1), connect.NewRequest(&inventoryv1.MetricSearchRequest{
				TeamId: team, GroupBy: group, Filters: window(from),
				Sort: &analytic_basev1.MetricSort{MetricId: lostMetricID, Field: "lost_amount"},
				Page: &analytic_basev1.PaginationFilter{Limit: limit},
			}))

			return err
		}
	}

	data := func(team uint64, group analytic_basev1.GroupType, from int, keys *analytic_basev1.MetricKeys) func(int) error {
		return func(int) error {
			_, err := svc.MetricData(ctxUser(1), connect.NewRequest(&inventoryv1.MetricDataRequest{
				TeamId: team, GroupBy: group, Filters: window(from), Keys: keys, MetricIds: []string{lostMetricID},
			}))

			return err
		}
	}

	products := make([]uint64, 0, 20)
	for i := range 20 {
		products = append(products, 1000+uint64(i))
	}

	days := make([]string, 0, 30)
	for d := range 30 {
		days = append(days, today.AddDate(0, 0, -d).Format("2006-01-02"))
	}

	dayKeys := &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}}

	perfRun(t, db, probe, "MetricSearch warehouse product-365d", 20, search(otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, 364, 20))
	perfRun(t, db, probe, "MetricSearch seller product-365d", 20, search(100, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, 364, 20))
	perfRun(t, db, probe, "MetricSearch root seller-365d", 20, search(1, analytic_basev1.GroupType_GROUP_TYPE_TEAM, 364, 20))
	perfRun(t, db, probe, "MetricSearch warehouse daily-30d", 30, search(otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 29, 30))
	perfRun(t, db, probe, "MetricData warehouse product-365d", 20, data(otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, 364, ids(products...)))
	perfRun(t, db, probe, "MetricData warehouse daily-30d", 30, data(otWarehouse, analytic_basev1.GroupType_GROUP_TYPE_DAILY, 29, dayKeys))
	perfRun(t, db, probe, "MetricData root summary-365d", 1, data(1, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, 364, nil))

	// THE WRITE PATH: a Stock Adjust "lost" — the fold is one upsert, its row today's.
	rack := newRack(t, svc, otWarehouse, "perf-lost")
	perfStock(t, db, otWarehouse, 1, 1, 100, []uint64{rack})

	var batch models.Batch

	err := db.Where("warehouse_id = ? AND product_id = ?", otWarehouse, perfFirstProduct).Order("id").Take(&batch).Error
	if err != nil {
		t.Fatalf("the perf batch: %v", err)
	}

	perfRun(t, db, probe, "StockAdjust lost (with the fold)", 1, func(int) error {
		_, err := svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
			WarehouseId: otWarehouse, ProductId: perfFirstProduct, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rack},
			ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, BatchId: batch.ID, Quantity: 1, Reason: "perf",
		}))

		return err
	})
}
