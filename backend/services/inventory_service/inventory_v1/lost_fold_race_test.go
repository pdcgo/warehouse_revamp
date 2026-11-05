//go:build raceaudit

// Concurrency audit for the LOST-STOCK FOLD (inventory_mutations/fold_lost.go — inventory-lost-counts-the-warehouses-
// custody-losses): every lost problem row adds to its day's `inventory_lost_daily_reports` row in its own transaction,
// with one INSERT … ON CONFLICT DO UPDATE. Many losses at one second land on ONE report row; none may be lost, and the
// row must never deadlock against the ledgers it follows. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_LostFold|TestInterleave_LostFold" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// raceLostOne marks one unit of `batch` lost on `rack` — a Stock Adjust "lost" as the warehouse Admin.
func raceLostOne(svc *inventory_v1.Service, product, batch, rack uint64) error {
	_, err := svc.StockAdjust(raceAdmin(43), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: raceWarehouse, ProductId: product, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rack},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, BatchId: batch, Quantity: 1,
		Reason: "gone from the shelf",
	}))

	return err
}

// lostReport is the report's units and value, and the register's lost rows' — the two must agree.
func lostReport(t *testing.T, db *gorm.DB) (reported, registered int64, reportedValue, registeredValue float64) {
	t.Helper()

	db.Raw(`SELECT COALESCE(SUM(lost_count), 0) FROM inventory_lost_daily_reports`).Scan(&reported)
	db.Raw(`SELECT COALESCE(SUM(lost_amount), 0)::float8 FROM inventory_lost_daily_reports`).Scan(&reportedValue)
	db.Raw(`SELECT COALESCE(SUM(problem_stock_count), 0) FROM warehouse_stock_problems WHERE problem_type = 'lost'`).Scan(&registered)
	db.Raw(`SELECT COALESCE(SUM(problem_stock_count * price_unit), 0)::float8 FROM warehouse_stock_problems WHERE problem_type = 'lost'`).
		Scan(&registeredValue)

	return reported, registered, reportedValue, registeredValue
}

// lostTargets is each product's two batches and two racks, as seedLedgers made them.
func lostTargets(t *testing.T, db *gorm.DB, product uint64) (batches, racks []uint64) {
	t.Helper()

	db.Model(&models.Batch{}).Where("product_id = ?", product).Order("id").Pluck("id", &batches)
	db.Model(&models.ProductPlacement{}).Where("product_id = ?", product).Order("placement_id").Pluck("placement_id", &racks)

	if len(batches) != 2 || len(racks) != 2 {
		t.Fatalf("seed: %d batches, %d racks, want 2 and 2", len(batches), len(racks))
	}

	return batches, racks
}

// ONE ROW, MANY LOSSES: twelve Stock Adjust "lost" at one second, two products, all on today's report rows for one
// owner — each adds, none is lost, no deadlock. The report equals the register.
func TestRace_LostFold_EveryLossAddsToTheDaysRow(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA, raceProductB)
	svc := raceService(h.DB())

	aBatches, aRacks := lostTargets(t, h.DB(), raceProductA)
	bBatches, bRacks := lostTargets(t, h.DB(), raceProductB)

	const n = 12

	res := h.Race(t, n, func(i int) error {
		if i%3 == 2 {
			return raceLostOne(svc, raceProductB, bBatches[i%2], bRacks[(i/2)%2])
		}

		return raceLostOne(svc, raceProductA, aBatches[i%2], aRacks[(i/2)%2])
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of %d losses failed — every one has stock to lose", res.Failed(), n)
	}

	reported, registered, value, registeredValue := lostReport(t, h.DB())
	if reported != n || registered != n || value != registeredValue || value != n*1000 {
		t.Fatalf("report %d units (Rp %v), register %d (Rp %v) — want %d and Rp %d in both",
			reported, value, registered, registeredValue, n, n*1000)
	}

	var rows int64
	h.DB().Model(&models.InventoryLostDailyReport{}).Count(&rows)

	if rows != 2 {
		t.Fatalf("%d report rows, want 2 — one per product for the day", rows)
	}
}

// AGAINST A COUNT'S FINALIZE: a count writes its shortage off as lost on product A while Stock Adjusts lose units of
// product B — both folds write the same day's report for the same owner (different rows), each the last lock of its
// transaction. Neither waits on the other's ledgers; both totals land.
func TestInterleave_LostFold_ACountAndAnAdjustFoldTogether(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA, raceProductB)
	svc := raceService(h.DB())

	bBatches, bRacks := lostTargets(t, h.DB(), raceProductB)

	// A count of product A: both racks counted 7 of 10 → 6 short, written off as lost.
	session, rows := raceCount(t, svc)
	for _, row := range rows {
		countAndMark(t, svc, row.GetId(), 7, 0)
	}

	res := h.Race(t, 5, func(i int) error {
		if i == 0 {
			_, err := svc.OpnameSessionFinalize(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionFinalizeRequest{
				TeamId: raceWarehouse, SessionId: session.GetId(),
			}))

			return err
		}

		return raceLostOne(svc, raceProductB, bBatches[i%2], bRacks[(i/2)%2])
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of 5 failed — a count and four adjusts on another product never conflict", res.Failed())
	}

	reported, registered, value, registeredValue := lostReport(t, h.DB())
	if reported != 10 || registered != 10 || value != registeredValue {
		t.Fatalf("report %d (Rp %v), register %d (Rp %v) — want 6 counted short + 4 adjusted, equal",
			reported, value, registered, registeredValue)
	}
}
