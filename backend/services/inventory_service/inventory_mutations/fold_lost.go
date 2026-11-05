package inventory_mutations

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"

	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE LOST-STOCK FOLD (inventory-lost-counts-the-warehouses-custody-losses, inventory-lost-is-gross) — every `lost`
// warehouse_stock_problems row adds its units and their value at the batch's price to its day's
// `inventory_lost_daily_reports` row, IN THE SAME TRANSACTION. Both doors call it: a count's finalize (its shortage
// written off as lost) and a Stock Adjust "lost". A broken row is never counted; nor is a transfer or a restock parcel
// lost on the way — those are other tables, written by other paths.
//
// Why in-process and not an event: inventory owns the problem rows AND the report, so one transaction keeps them equal
// by construction — no topic, no redelivery to dedupe, never behind.
//
// CONCURRENCY: one multi-row `INSERT … ON CONFLICT DO UPDATE` — the conflict takes the existing row's lock and adds, so
// two posts into one row queue and neither is lost. The rows are summed per key first (a statement may not touch a row
// twice) and written in key order, so two posts touching several rows take their locks in the same order. The report
// rows are always the LAST locks of their transaction (lock-order.md).

// lostKey is one report row's identity, the day aside.
type lostKey struct {
	warehouseID, teamID, productID, supplierID uint64
}

// lostRow is one lost problem row as the fold reads it — its units at its batch's price, and the batch's supplier.
type lostRow struct {
	problem    models.WarehouseStockProblem
	supplierID uint64
}

// foldLost adds the lost rows to today's report rows (a Jakarta day — the day the loss was written). Rows of another
// type are skipped.
func foldLost(tx *gorm.DB, now time.Time, rows []lostRow) error {
	sums := map[lostKey]*models.InventoryLostDailyReport{}

	for _, r := range rows {
		p := r.problem
		if p.ProblemType != models.ProblemLost || p.ProblemStockCount <= 0 {
			continue
		}

		key := lostKey{p.WarehouseID, p.TeamID, p.ProductID, r.supplierID}

		s := sums[key]
		if s == nil {
			s = &models.InventoryLostDailyReport{
				WarehouseID: p.WarehouseID, TeamID: p.TeamID, ProductID: p.ProductID, SupplierID: r.supplierID,
			}
			sums[key] = s
		}

		s.LostCount += p.ProblemStockCount
		// At the batch's price (inventory-lost-counts-the-warehouses-custody-losses) — what the warehouse owes.
		s.LostAmount += float64(p.ProblemStockCount) * p.PriceUnit
	}

	if len(sums) == 0 {
		return nil
	}

	keys := make([]lostKey, 0, len(sums))
	for k := range sums {
		keys = append(keys, k)
	}

	slices.SortFunc(keys, func(a, b lostKey) int {
		return cmp.Or(
			cmp.Compare(a.warehouseID, b.warehouseID),
			cmp.Compare(a.teamID, b.teamID),
			cmp.Compare(a.productID, b.productID),
			cmp.Compare(a.supplierID, b.supplierID),
		)
	})

	day := now.In(wib).Format("2006-01-02")
	values := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys)*6)

	for _, k := range keys {
		s := sums[k]
		values = append(values, "(CAST(? AS date), ?, ?, ?, ?, ?, ROUND(CAST(? AS numeric), 2), NOW())")
		args = append(args, day, s.WarehouseID, s.TeamID, s.ProductID, s.SupplierID, s.LostCount, s.LostAmount)
	}

	err := tx.Exec(`
INSERT INTO inventory_lost_daily_reports
    (day, warehouse_id, team_id, product_id, supplier_id, lost_count, lost_amount, last_updated)
VALUES `+strings.Join(values, ", ")+`
ON CONFLICT (day, warehouse_id, team_id, product_id, supplier_id) DO UPDATE SET
    lost_count   = inventory_lost_daily_reports.lost_count + EXCLUDED.lost_count,
    lost_amount  = inventory_lost_daily_reports.lost_amount + EXCLUDED.lost_amount,
    last_updated = NOW()`, args...).Error
	if err != nil {
		return fmt.Errorf("lost stock report: %w", err)
	}

	return nil
}
