package supplier_v1

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// THE REPORTS' WAREHOUSE, BACKFILLED (docs/technical/frontend/suppliers_decision.md#the-supplier-reports-carry-the-warehouse)
// — what `san supplier backfill-warehouses` runs, through this service's own methods:
//
//  1. SalePartWarehouses — every Penjualan part folded before the warehouse was recorded (00006 filed it under 0) is
//     re-read from its order's take, under the warehouse its units were taken from;
//  2. UnplacedReportDays — every supplier day of either report still holding a row under warehouse 0 — and DayRefold of
//     each, which rebuilds the day from the fold's own claims keyed by warehouse (the restock's claims carry the
//     receiving warehouse; the sales claims are the parts step 1 filed);
//  3. ReportTotals before and after — every supplier's figures summed over every day and warehouse, which must not move:
//     with no chip, Statistik reads what it read before. Only a re-fold's own repair moves them — an event the fold
//     never received, claimed and counted now (DayRefoldResult.Claimed); a claim pruned after 45 days and claimed again
//     moves nothing, its figures were already in the rows.
//
// Repeatable: a second run finds no part and no row under warehouse 0, and does nothing.

// SalePartBackfillResult is what SalePartWarehouses did with the orders whose parts were filed under no warehouse.
type SalePartBackfillResult struct {
	// Orders whose parts were filed under no warehouse.
	Orders int
	// FromTake were re-read from their take — each part under the warehouse its units were taken from.
	FromTake int
	// FromOrder were filed whole under the warehouse the order shipped from: their take no longer reads as their parts do
	// (a batch moved to another supplier since), so the parts keep their figures and only gain the warehouse.
	FromOrder int
	// Unresolved are left under no warehouse: the log holds no placement for them. They still count with no chip.
	Unresolved int
}

// SalePartWarehouses files every Penjualan part folded before the warehouse was recorded under the warehouse its units
// were taken from. Per order, the order's placement is read from the log (OrderSalesOn on the order's placed day) and its
// take from inventory, both BEFORE the transaction — the sales fold's own order of work; then, under the order's row
// lock (the lock a placement and a cancel of the order meet on), its parts are replaced when the take prices them the
// same, or filed under the order's warehouse when it does not. A part's units and value never change here: the cancel
// still takes back exactly what the placement added.
func (s *Service) SalePartWarehouses(ctx context.Context, source RefoldSource) (SalePartBackfillResult, error) {
	result := SalePartBackfillResult{}

	if source == nil {
		return result, errRefoldNoSource
	}

	days := []time.Time{}

	err := s.db.WithContext(ctx).
		Raw(`SELECT DISTINCT o.placed_day
FROM supplier_sale_order_parts p
JOIN supplier_sale_orders o ON o.order_id = p.order_id
WHERE p.warehouse_id = 0 AND o.placed_day IS NOT NULL
ORDER BY o.placed_day`).
		Scan(&days).
		Error
	if err != nil {
		return result, fmt.Errorf("supplier warehouses: the days of the unfiled parts: %w", err)
	}

	for _, at := range days {
		day := at.Format(dateLayout)

		orders := []uint64{}

		err = s.db.WithContext(ctx).
			Raw(`SELECT DISTINCT p.order_id
FROM supplier_sale_order_parts p
JOIN supplier_sale_orders o ON o.order_id = p.order_id
WHERE p.warehouse_id = 0 AND o.placed_day = CAST(? AS date)
ORDER BY p.order_id`, day).
			Scan(&orders).
			Error
		if err != nil {
			return result, fmt.Errorf("supplier warehouses: the unfiled orders of %s: %w", day, err)
		}

		events, err := source.OrderSalesOn(ctx, day)
		if err != nil {
			return result, fmt.Errorf("supplier warehouses: the orders of %s: %w", day, err)
		}

		placements := map[uint64]int{}

		for i, event := range events {
			if placed := event.GetOrderPlaced(); placed != nil {
				placements[placed.GetOrderId()] = i
			}
		}

		for _, orderID := range orders {
			result.Orders++

			at, found := placements[orderID]
			if !found {
				result.Unresolved++

				continue
			}

			placed := events[at].GetOrderPlaced()

			take, err := s.goods.OrderTakeSuppliers(ctx, placed.GetTransactionId())
			if err != nil {
				return result, fmt.Errorf("supplier warehouses: order %d's take: %w", orderID, err)
			}

			fresh := saleParts(placed, take)

			outcome, err := s.fileSaleParts(ctx, orderID, fresh, placed.GetWarehouseId())
			if err != nil {
				return result, err
			}

			switch outcome {
			case filedFromTake:
				result.FromTake++
			case filedFromOrder:
				result.FromOrder++
			case filedNowhere:
				result.Unresolved++
			}
		}
	}

	return result, nil
}

type partFiling int

const (
	filedAlready partFiling = iota
	filedFromTake
	filedFromOrder
	filedNowhere
)

// fileSaleParts files one order's unfiled parts, under its row lock.
func (s *Service) fileSaleParts(ctx context.Context, orderID uint64, fresh []salePart, orderWarehouse uint64) (partFiling, error) {
	outcome := filedAlready

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := claimSaleOrder(tx, orderID)
		if err != nil {
			return err
		}

		var stored []supplier_service_models.SupplierSaleOrderPart

		err = tx.
			Where("order_id = ? AND warehouse_id = 0", orderID).
			Order("supplier_id, product_id, team_id").
			Find(&stored).
			Error
		if err != nil {
			return err
		}

		// Filed meanwhile by another run.
		if len(stored) == 0 {
			return nil
		}

		if sameSaleParts(stored, fresh) {
			err = tx.Exec(`DELETE FROM supplier_sale_order_parts WHERE order_id = ? AND warehouse_id = 0`, orderID).Error
			if err != nil {
				return err
			}

			rows := make([]supplier_service_models.SupplierSaleOrderPart, 0, len(fresh))
			for _, p := range fresh {
				rows = append(rows, supplier_service_models.SupplierSaleOrderPart{
					OrderID: orderID, SupplierID: p.SupplierID, ProductID: p.ProductID, TeamID: p.TeamID,
					WarehouseID: p.WarehouseID, Units: p.Units, Value: p.Value,
				})
			}

			err = tx.Create(&rows).Error
			if err != nil {
				return fmt.Errorf("supplier warehouses: order %d's parts: %w", orderID, err)
			}

			outcome = filedFromTake

			return nil
		}

		if orderWarehouse == 0 {
			outcome = filedNowhere

			return nil
		}

		err = tx.Exec(`UPDATE supplier_sale_order_parts SET warehouse_id = ? WHERE order_id = ? AND warehouse_id = 0`,
			orderWarehouse, orderID).Error
		if err != nil {
			return fmt.Errorf("supplier warehouses: order %d's parts: %w", orderID, err)
		}

		outcome = filedFromOrder

		return nil
	})

	return outcome, err
}

// sameSaleParts says whether the take, priced again, adds up to what the order's parts hold — per supplier, product
// and team, the units exactly and the value within san_money's tolerance. Only then may the take's warehouses split it.
func sameSaleParts(stored []supplier_service_models.SupplierSaleOrderPart, fresh []salePart) bool {
	type key struct{ supplier, product, team uint64 }

	type sum struct {
		units int64
		value float64
	}

	held := map[key]sum{}
	for _, p := range stored {
		k := key{p.SupplierID, p.ProductID, p.TeamID}
		s := held[k]
		held[k] = sum{s.units + p.Units, s.value + p.Value}
	}

	priced := map[key]sum{}
	for _, p := range fresh {
		k := key{p.SupplierID, p.ProductID, p.TeamID}
		s := priced[k]
		priced[k] = sum{s.units + p.Units, s.value + p.Value}
	}

	if len(held) != len(priced) {
		return false
	}

	for k, h := range held {
		p, found := priced[k]
		if !found || p.units != h.units || !san_money.Equal(p.value, h.value) {
			return false
		}
	}

	return true
}

// UnplacedDay is one supplier day of one report that still holds a row under warehouse 0.
type UnplacedDay struct {
	Report     string
	SupplierID uint64
	Day        string
}

// UnplacedReportDays lists every supplier day of both reports holding a row folded before the warehouse was recorded —
// the restock report's first, each by supplier and day.
func (s *Service) UnplacedReportDays(ctx context.Context) ([]UnplacedDay, error) {
	out := []UnplacedDay{}

	for _, report := range []struct{ name, table string }{
		{ReportRestockDaily, restockTable},
		{ReportSaleDaily, salesTable},
	} {
		rows := []struct {
			SupplierID uint64
			Day        time.Time
		}{}

		err := s.db.WithContext(ctx).
			Raw(fmt.Sprintf(`SELECT DISTINCT supplier_id, day FROM %s WHERE warehouse_id = 0 ORDER BY supplier_id, day`, report.table)).
			Scan(&rows).
			Error
		if err != nil {
			return nil, fmt.Errorf("supplier warehouses: the unfiled days of %s: %w", report.table, err)
		}

		for _, r := range rows {
			out = append(out, UnplacedDay{Report: report.name, SupplierID: r.SupplierID, Day: r.Day.Format(dateLayout)})
		}
	}

	return out, nil
}

// SupplierTotals is one supplier's figures summed over every day and warehouse of both reports — the no-chip figures —
// and how many of its rows sit under no warehouse.
type SupplierTotals struct {
	SupplierID uint64
	supplier_service_models.SupplierFigureSums
	UnplacedRows int64
}

// Same says whether two suppliers' totals are equal — counts exactly, values within san_money's tolerance.
func (t SupplierTotals) Same(other SupplierTotals) bool {
	a, b := t.SupplierFigureSums, other.SupplierFigureSums

	return a.RestockCount == b.RestockCount && san_money.Equal(a.RestockValuation, b.RestockValuation) &&
		a.ShippingLostCount == b.ShippingLostCount && san_money.Equal(a.ShippingLostValuation, b.ShippingLostValuation) &&
		a.ShippingBrokenCount == b.ShippingBrokenCount &&
		san_money.Equal(a.ShippingBrokenValuation, b.ShippingBrokenValuation) &&
		a.SalesCount == b.SalesCount && san_money.Equal(a.SalesValue, b.SalesValue)
}

// ReportTotals is every supplier's totals, by supplier id. Two statements, one per report, each one grouped scan.
func (s *Service) ReportTotals(ctx context.Context) (map[uint64]SupplierTotals, error) {
	out := map[uint64]SupplierTotals{}

	restock := []struct {
		SupplierID uint64
		supplier_service_models.SupplierFigureSums
		Unplaced int64
	}{}

	err := s.db.WithContext(ctx).
		Raw(`SELECT r.supplier_id, ` + figureSums("r") + `, COUNT(*) FILTER (WHERE r.warehouse_id = 0) AS unplaced
FROM supplier_product_daily_reports r GROUP BY r.supplier_id`).
		Scan(&restock).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier warehouses: the restock totals: %w", err)
	}

	for _, r := range restock {
		t := out[r.SupplierID]
		t.SupplierID = r.SupplierID
		t.SupplierMetricColumns = r.SupplierMetricColumns
		t.UnplacedRows += r.Unplaced
		out[r.SupplierID] = t
	}

	sales := []struct {
		SupplierID uint64
		SalesCount int64
		SalesValue float64
		Unplaced   int64
	}{}

	err = s.db.WithContext(ctx).
		Raw(`SELECT r.supplier_id, ` + salesSums("r") + `, COUNT(*) FILTER (WHERE r.warehouse_id = 0) AS unplaced
FROM supplier_sale_daily_reports r GROUP BY r.supplier_id`).
		Scan(&sales).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier warehouses: the sales totals: %w", err)
	}

	for _, r := range sales {
		t := out[r.SupplierID]
		t.SupplierID = r.SupplierID
		t.SalesCount = r.SalesCount
		t.SalesValue = r.SalesValue
		t.UnplacedRows += r.Unplaced
		out[r.SupplierID] = t
	}

	return out, nil
}
