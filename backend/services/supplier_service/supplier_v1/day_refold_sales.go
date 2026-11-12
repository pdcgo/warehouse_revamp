package supplier_v1

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// THE PENJUALAN RE-FOLD (supplier-sale-daily) — see day_refold.go for the rule it shares.
//
// The fold's CLAIM here is the order's row in `supplier_sale_orders` (placed_day, cancelled_day) with its parts, so the
// day is rebuilt from it exactly as the fold sums it: every part of an order PLACED on the day, added; every part of an
// order CANCELLED on the day whose placement was folded, taken back. A lost placement is claimed the fold's way — its
// row's placed_day and its parts, priced from the take by the fold's own saleParts — and a lost cancel by its
// cancelled_day; a redelivery then finds the day set and folds nothing.
//
// ⚠ ONE ORDER FEEDS SEVERAL SUPPLIERS, AND ITS CANCEL ANOTHER DAY. A lost event claimed here is counted for this
// supplier's day only; every other supplier the order's parts name — and the cancel's own day, when the late placement
// had been cancelled already — is then short by it until its own re-fold (DayRefoldResult.Short names each).

// saleEntry is one of the day's moves as the log holds it: a placement or a cancel, its age, and — for a placement
// nobody had claimed when the log was read — its parts, priced from its take.
type saleEntry struct {
	orderID   uint64
	placement bool
	old       bool
	parts     []salePart
	priced    bool
}

// saleLog reads the day's placements and cancels, and prices each placement nobody has claimed yet from its take —
// asked of inventory BEFORE the transaction, as the fold asks before its own.
func (s *Service) saleLog(ctx context.Context, day string, source RefoldSource) ([]saleEntry, error) {
	events, err := source.OrderSalesOn(ctx, day)
	if err != nil {
		return nil, fmt.Errorf("supplier re-fold: the day's orders: %w", err)
	}

	ids := []uint64{}

	for _, event := range events {
		if placed := event.GetOrderPlaced(); placed != nil {
			ids = append(ids, placed.GetOrderId())
		}
	}

	folded := map[uint64]bool{}

	if len(ids) > 0 {
		rows := []uint64{}

		err = s.db.WithContext(ctx).
			Raw(`SELECT order_id FROM supplier_sale_orders WHERE order_id IN ? AND placed_day IS NOT NULL`, ids).
			Scan(&rows).
			Error
		if err != nil {
			return nil, fmt.Errorf("supplier re-fold: the folded placements: %w", err)
		}

		for _, id := range rows {
			folded[id] = true
		}
	}

	entries := make([]saleEntry, 0, len(events))

	for _, event := range events {
		old := time.Since(event.GetOccurredAt().AsTime()) >= refoldInFlight

		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_OrderPlaced:
			placed := variant.OrderPlaced
			entry := saleEntry{orderID: placed.GetOrderId(), placement: true, old: old}

			if old && !folded[placed.GetOrderId()] {
				take, err := s.goods.OrderTakeSuppliers(ctx, placed.GetTransactionId())
				if err != nil {
					return nil, fmt.Errorf("supplier re-fold: order %d's take: %w", placed.GetOrderId(), err)
				}

				entry.parts = saleParts(placed, take)
				entry.priced = true
			}

			entries = append(entries, entry)
		case *eventsv1.Event_OrderCancelled:
			entries = append(entries, saleEntry{orderID: variant.OrderCancelled.GetOrderId(), old: old})
		}
	}

	// ONE LOCK ORDER over the orders' rows — by order, its placement before its cancel — so two re-folds of one day
	// never wait on each other in a cycle; a fold locks one order row only.
	slices.SortFunc(entries, func(a, b saleEntry) int {
		if a.orderID != b.orderID {
			return cmp.Compare(a.orderID, b.orderID)
		}

		if a.placement == b.placement {
			return 0
		}

		if a.placement {
			return -1
		}

		return 1
	})

	return entries, nil
}

func refoldSaleDay(tx *gorm.DB, in DayRefoldInput, entries []saleEntry) (DayRefoldResult, error) {
	result := DayRefoldResult{DryRun: in.DryRun, Columns: salesColumns}

	day, err := parseDate(in.Day)
	if err != nil {
		return result, err
	}

	short := map[ShortScope]bool{}

	// 1 · CLAIM THE LOST MOVES, the fold's way, under each order's row lock — before the report's lock, as the fold.
	for _, entry := range entries {
		if !entry.old || (entry.placement && !entry.priced) {
			continue
		}

		order, err := claimSaleOrder(tx, entry.orderID)
		if err != nil {
			return result, err
		}

		if entry.placement {
			claimed, err := claimLostPlacement(tx, order, entry, day)
			if err != nil {
				return result, err
			}

			if !claimed {
				continue
			}

			result.Claimed++

			for _, part := range entry.parts {
				if part.SupplierID != in.SupplierID {
					short[ShortScope{SupplierID: part.SupplierID, Day: in.Day}] = true
				}

				// Cancelled before this placement was folded: the fold would take it back on the cancel's day now.
				if order.CancelledDay != nil && order.CancelledDay.Format(dateLayout) != in.Day {
					short[ShortScope{SupplierID: part.SupplierID, Day: order.CancelledDay.Format(dateLayout)}] = true
				}
			}

			continue
		}

		// A lost cancel.
		if order.CancelledDay != nil {
			continue
		}

		err = tx.Model(&supplier_service_models.SupplierSaleOrder{}).
			Where("order_id = ?", entry.orderID).
			Updates(map[string]any{"cancelled_day": in.Day, "updated_at": gorm.Expr("NOW()")}).
			Error
		if err != nil {
			return result, fmt.Errorf("supplier re-fold: claim order %d's cancel: %w", entry.orderID, err)
		}

		result.Claimed++

		if order.PlacedDay == nil {
			// The placement is not folded yet: whoever folds it takes it back on this day.
			continue
		}

		suppliers := []uint64{}

		err = tx.
			Raw(`SELECT DISTINCT supplier_id FROM supplier_sale_order_parts WHERE order_id = ? AND supplier_id <> ?`,
				entry.orderID, in.SupplierID).
			Scan(&suppliers).
			Error
		if err != nil {
			return result, fmt.Errorf("supplier re-fold: order %d's parts: %w", entry.orderID, err)
		}

		for _, supplier := range suppliers {
			short[ShortScope{SupplierID: supplier, Day: in.Day}] = true
		}
	}

	for scope := range short {
		result.Short = append(result.Short, scope)
	}

	slices.SortFunc(result.Short, func(a, b ShortScope) int {
		return cmp.Or(cmp.Compare(a.Day, b.Day), cmp.Compare(a.SupplierID, b.SupplierID))
	})

	// 2 · THE FOLD's OWN LOCK — every upsert's ROW EXCLUSIVE on the report waits on this, and this on every upsert.
	err = tx.Exec(`LOCK TABLE supplier_sale_daily_reports IN SHARE ROW EXCLUSIVE MODE`).Error
	if err != nil {
		return result, fmt.Errorf("supplier re-fold: lock the report: %w", err)
	}

	// 3 · UNDER THE LOCK, the day as the claims hold it: the supplier's parts of every order placed on it, added, and of
	// every order cancelled on it whose placement was folded, taken back — the fold's sum.
	parts := []struct {
		OrderID   uint64
		Sign      int64
		ProductID uint64
		TeamID    uint64
		Units     int64
		Value     float64
	}{}

	err = tx.
		Raw(`
SELECT x.order_id, x.sign, p.product_id, p.team_id, p.units, p.value
FROM (
    SELECT order_id, 1 AS sign FROM supplier_sale_orders WHERE placed_day = CAST(@day AS date)
  UNION ALL
    SELECT order_id, -1 FROM supplier_sale_orders WHERE cancelled_day = CAST(@day AS date) AND placed_day IS NOT NULL
) x
JOIN supplier_sale_order_parts p ON p.order_id = x.order_id AND p.supplier_id = @supplier
ORDER BY x.order_id, x.sign DESC, p.product_id, p.team_id`,
			map[string]any{"day": in.Day, "supplier": in.SupplierID}).
		Scan(&parts).
		Error
	if err != nil {
		return result, fmt.Errorf("supplier re-fold: the day's claimed parts: %w", err)
	}

	after := map[refoldKey][]float64{}
	moves := map[[2]int64]bool{}

	for _, part := range parts {
		moves[[2]int64{int64(part.OrderID), part.Sign}] = true

		key := refoldKey{ProductID: part.ProductID, TeamID: part.TeamID}

		row := after[key]
		if row == nil {
			row = make([]float64, len(salesColumns))
			after[key] = row
		}

		row[0] += float64(part.Sign * part.Units)
		row[1] += float64(part.Sign) * part.Value
	}

	result.Counted = len(moves)

	// IN FLIGHT: the day's moves nobody has claimed, under the lock.
	inFlight, err := unclaimedSales(tx, entries)
	if err != nil {
		return result, err
	}

	result.InFlight = inFlight

	// 4 · THE STORED ROWS, then replace what differs and remove what the claims do not hold.
	stored := []struct {
		ProductID  uint64
		TeamID     uint64
		SalesCount int64
		SalesValue float64
	}{}

	err = tx.
		Raw(`SELECT product_id, team_id, sales_count, sales_value FROM supplier_sale_daily_reports
WHERE day = CAST(? AS date) AND supplier_id = ?`, in.Day, in.SupplierID).
		Scan(&stored).
		Error
	if err != nil {
		return result, fmt.Errorf("supplier re-fold: the day's rows: %w", err)
	}

	before := map[refoldKey][]float64{}
	for _, r := range stored {
		before[refoldKey{ProductID: r.ProductID, TeamID: r.TeamID}] = []float64{float64(r.SalesCount), r.SalesValue}
	}

	result.Rows, err = replaceDayRows(tx, "supplier_sale_daily_reports", salesColumns, in, before, after)
	if err != nil {
		return result, err
	}

	return result, nil
}

// claimLostPlacement is the sales fold's placement claim for an event that never arrived: the order's placed_day and its
// parts, as foldSalePlaced writes them — without the report rows, which the re-fold rewrites from the claims. False when
// a fold or another re-fold placed it first.
func claimLostPlacement(tx *gorm.DB, order supplier_service_models.SupplierSaleOrder, entry saleEntry, day time.Time) (bool, error) {
	if order.PlacedDay != nil {
		return false, nil
	}

	err := tx.Model(&supplier_service_models.SupplierSaleOrder{}).
		Where("order_id = ?", entry.orderID).
		Updates(map[string]any{"placed_day": day.Format(dateLayout), "updated_at": gorm.Expr("NOW()")}).
		Error
	if err != nil {
		return false, fmt.Errorf("supplier re-fold: claim order %d's placement: %w", entry.orderID, err)
	}

	if len(entry.parts) == 0 {
		return true, nil
	}

	rows := make([]supplier_service_models.SupplierSaleOrderPart, 0, len(entry.parts))
	for _, p := range entry.parts {
		rows = append(rows, supplier_service_models.SupplierSaleOrderPart{
			OrderID: entry.orderID, SupplierID: p.SupplierID, ProductID: p.ProductID, TeamID: p.TeamID,
			Units: p.Units, Value: p.Value,
		})
	}

	err = tx.Create(&rows).Error
	if err != nil {
		return false, fmt.Errorf("supplier re-fold: order %d's parts: %w", entry.orderID, err)
	}

	return true, nil
}

// unclaimedSales counts the day's moves whose claim is still unset — in flight, left to the fold.
func unclaimedSales(tx *gorm.DB, entries []saleEntry) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}

	ids := make([]uint64, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.orderID)
	}

	rows := []supplier_service_models.SupplierSaleOrder{}

	err := tx.
		Where("order_id IN ?", ids).
		Find(&rows).
		Error
	if err != nil {
		return 0, fmt.Errorf("supplier re-fold: the day's order rows: %w", err)
	}

	byOrder := make(map[uint64]supplier_service_models.SupplierSaleOrder, len(rows))
	for _, row := range rows {
		byOrder[row.OrderID] = row
	}

	count := 0

	for _, entry := range entries {
		row := byOrder[entry.orderID]

		if (entry.placement && row.PlacedDay == nil) || (!entry.placement && row.CancelledDay == nil) {
			count++
		}
	}

	return count, nil
}
