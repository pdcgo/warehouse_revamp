package supplier_v1

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SalesFoldHandler is the push handler that builds PENJUALAN — `supplier_sale_daily_reports` — from `OrderPlaced` and
// `OrderCancelled` (penjualan-is-the-selling-value-on-the-order-day): the shape of the order metrics and the warehouse
// fee (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day).
//
//   - placed: the units the order's stock take drew from batches carrying a supplier (asked of inventory,
//     GoodsReader.OrderTakeSuppliers), at their share of what the order sold them for, ADDED on the Jakarta day the order
//     was placed;
//   - cancelled: exactly what the placement added, SUBTRACTED on the cancel's own Jakarta day. An earlier day never
//     changes.
//
// ONE ROW PER ORDER (`supplier_sale_orders`) is the claim, locked FOR UPDATE, so a redelivery folds nothing twice and the
// two events may arrive in either order: a cancel first leaves the cancel's day on the row, and the late placement then
// adds on its day and takes back on the cancel's in one transaction.
//
// Any other variant is ACKED — redelivering a message nothing here will ever handle is a loop, not a retry.
func (s *Service) SalesFoldHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_OrderPlaced:
			return s.foldSalePlaced(ctx, event, variant.OrderPlaced)
		case *eventsv1.Event_OrderCancelled:
			return s.foldSaleCancelled(ctx, event, variant.OrderCancelled)
		default:
			return nil
		}
	}
}

// salePart is what one order adds for one supplier, product and owning team.
type salePart struct {
	SupplierID uint64
	ProductID  uint64
	TeamID     uint64
	Units      int64
	Value      float64
}

var errSaleNoOrder = errors.New("supplier sales fold: the event names no order")

// saleDay is the Jakarta day an event happened on — the order's day for a placement, the cancel's for a cancel
// (a-fact-counts-on-the-day-it-happened). Never the host's zone: a UTC host would put 00:30 WIB on the day before.
func saleDay(event *eventsv1.Event) (time.Time, error) {
	occurred := event.GetOccurredAt()
	if occurred == nil {
		return time.Time{}, fmt.Errorf("supplier sales fold: %s carries no occurred_at", event.GetEventId())
	}

	local := occurred.AsTime().In(jakarta)

	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC), nil
}

func (s *Service) foldSalePlaced(ctx context.Context, event *eventsv1.Event, placed *eventsv1.OrderPlaced) error {
	if placed.GetOrderId() == 0 {
		return errSaleNoOrder
	}

	day, err := saleDay(event)
	if err != nil {
		return err
	}

	// The take is inventory's, read BEFORE the transaction — a read of rows no one rewrites (the take's own ledger rows),
	// so nothing here needs to hold a lock while it is asked. An error NACKs: the sale must not be acknowledged unread.
	take, err := s.goods.OrderTakeSuppliers(ctx, placed.GetTransactionId())
	if err != nil {
		return fmt.Errorf("supplier sales fold: order %d's take: %w", placed.GetOrderId(), err)
	}

	parts := saleParts(placed, take)

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		order, err := claimSaleOrder(tx, placed.GetOrderId())
		if err != nil {
			return err
		}

		// Folded already — a redelivery.
		if order.PlacedDay != nil {
			return nil
		}

		err = tx.Model(&supplier_service_models.SupplierSaleOrder{}).
			Where("order_id = ?", placed.GetOrderId()).
			Updates(map[string]any{"placed_day": day.Format(dateLayout), "updated_at": gorm.Expr("NOW()")}).
			Error
		if err != nil {
			return err
		}

		if len(parts) == 0 {
			return nil
		}

		rows := make([]supplier_service_models.SupplierSaleOrderPart, 0, len(parts))
		for _, p := range parts {
			rows = append(rows, supplier_service_models.SupplierSaleOrderPart{
				OrderID: placed.GetOrderId(), SupplierID: p.SupplierID, ProductID: p.ProductID, TeamID: p.TeamID,
				Units: p.Units, Value: p.Value,
			})
		}

		err = tx.Create(&rows).Error
		if err != nil {
			return fmt.Errorf("supplier sales fold: order %d's parts: %w", placed.GetOrderId(), err)
		}

		err = addSales(tx, day, parts, 1)
		if err != nil {
			return err
		}

		// Cancelled before this placement arrived: take it back on the cancel's day, now.
		if order.CancelledDay != nil {
			return addSales(tx, *order.CancelledDay, parts, -1)
		}

		return nil
	})
}

func (s *Service) foldSaleCancelled(ctx context.Context, event *eventsv1.Event, cancelled *eventsv1.OrderCancelled) error {
	if cancelled.GetOrderId() == 0 {
		return errSaleNoOrder
	}

	day, err := saleDay(event)
	if err != nil {
		return err
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		order, err := claimSaleOrder(tx, cancelled.GetOrderId())
		if err != nil {
			return err
		}

		// Taken back already — a redelivery.
		if order.CancelledDay != nil {
			return nil
		}

		err = tx.Model(&supplier_service_models.SupplierSaleOrder{}).
			Where("order_id = ?", cancelled.GetOrderId()).
			Updates(map[string]any{"cancelled_day": day.Format(dateLayout), "updated_at": gorm.Expr("NOW()")}).
			Error
		if err != nil {
			return err
		}

		// The placement has not been folded yet: it will take this back itself, on this day.
		if order.PlacedDay == nil {
			return nil
		}

		var rows []supplier_service_models.SupplierSaleOrderPart

		err = tx.
			Where("order_id = ?", cancelled.GetOrderId()).
			Order("supplier_id, product_id, team_id").
			Find(&rows).
			Error
		if err != nil {
			return err
		}

		parts := make([]salePart, 0, len(rows))
		for _, r := range rows {
			parts = append(parts, salePart{
				SupplierID: r.SupplierID, ProductID: r.ProductID, TeamID: r.TeamID, Units: r.Units, Value: r.Value,
			})
		}

		return addSales(tx, day, parts, -1)
	})
}

// claimSaleOrder makes sure the order's row exists and LOCKS it — the one lock a placement and a cancel of the same
// order meet on, so neither can read the other half-done.
func claimSaleOrder(tx *gorm.DB, orderID uint64) (supplier_service_models.SupplierSaleOrder, error) {
	var order supplier_service_models.SupplierSaleOrder

	err := tx.Exec(`INSERT INTO supplier_sale_orders (order_id) VALUES (?) ON CONFLICT (order_id) DO NOTHING`, orderID).Error
	if err != nil {
		return order, err
	}

	err = tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("order_id = ?", orderID).
		Take(&order).
		Error
	if err != nil {
		return order, err
	}

	return order, nil
}

// addSales adds `sign` × the parts to their day's rows — ONE statement. ⚠ ORDER BY the row key: the fold's one lock
// order over a day's rows, so two orders of one day touching the same suppliers wait rather than deadlock.
func addSales(tx *gorm.DB, day time.Time, parts []salePart, sign int64) error {
	if len(parts) == 0 {
		return nil
	}

	var suppliers, products, teams, units []int64

	var values []float64

	for _, p := range parts {
		suppliers = append(suppliers, int64(p.SupplierID))
		products = append(products, int64(p.ProductID))
		teams = append(teams, int64(p.TeamID))
		units = append(units, sign*p.Units)
		values = append(values, float64(sign)*p.Value)
	}

	err := tx.Exec(`
INSERT INTO supplier_sale_daily_reports AS d (day, supplier_id, product_id, team_id, sales_count, sales_value, last_updated)
SELECT CAST(@day AS date), l.supplier_id, l.product_id, l.team_id, SUM(l.units), SUM(l.value), NOW()
FROM unnest(
    CAST(@suppliers AS bigint[]), CAST(@products AS bigint[]), CAST(@teams AS bigint[]),
    CAST(@units AS bigint[]), CAST(@values AS double precision[])
) AS l(supplier_id, product_id, team_id, units, value)
GROUP BY l.supplier_id, l.product_id, l.team_id
ORDER BY l.supplier_id, l.product_id, l.team_id
ON CONFLICT (day, supplier_id, product_id, team_id) DO UPDATE
SET sales_count  = d.sales_count + EXCLUDED.sales_count,
    sales_value  = d.sales_value + EXCLUDED.sales_value,
    last_updated = NOW()`,
		map[string]any{
			"day":       day.Format(dateLayout),
			"suppliers": int64Array(suppliers),
			"products":  int64Array(products),
			"teams":     int64Array(teams),
			"units":     int64Array(units),
			"values":    float64Array(values),
		},
	).Error
	if err != nil {
		return fmt.Errorf("supplier sales fold: the day's rows: %w", err)
	}

	return nil
}

// saleParts prices an order's take — the selling value (penjualan-is-the-selling-value-on-the-order-day):
//
//   - each LINE's share of what the order sold for, `platform_total` (the-total-is-ours-the-platform-total-is-theirs —
//     an order line stores no platform price), split by the lines' frozen `total`; when no line has a total, by their
//     quantities;
//   - a product's units each at its lines' share ÷ their quantity, so the supplier whose batches gave 8 of 9 units gets
//     8 ninths of it.
//
// Exact, never rounded (the-backend-never-rounds-money). A platform total of 0 (not recorded) values the units at 0 and
// still counts them. Sorted by the row key, the fold's lock order.
func saleParts(placed *eventsv1.OrderPlaced, take []SaleTakePart) []salePart {
	lines := placed.GetLines()

	var totals float64

	var quantities int64

	for _, line := range lines {
		if line.GetTotal() > 0 {
			totals += line.GetTotal()
		}

		quantities += int64(line.GetQuantity())
	}

	type price struct {
		value float64
		qty   int64
	}

	prices := map[uint64]*price{}

	for _, line := range lines {
		var share float64

		switch {
		case totals > 0 && line.GetTotal() > 0:
			share = placed.GetPlatformTotal() * line.GetTotal() / totals
		case totals == 0 && quantities > 0:
			share = placed.GetPlatformTotal() * float64(line.GetQuantity()) / float64(quantities)
		}

		p := prices[line.GetProductId()]
		if p == nil {
			p = &price{}
			prices[line.GetProductId()] = p
		}

		p.value += share
		p.qty += int64(line.GetQuantity())
	}

	parts := make([]salePart, 0, len(take))

	for _, t := range take {
		if t.Units <= 0 {
			continue
		}

		var value float64
		if p := prices[t.ProductID]; p != nil && p.qty > 0 {
			value = p.value * float64(t.Units) / float64(p.qty)
		}

		parts = append(parts, salePart{
			SupplierID: t.SupplierID, ProductID: t.ProductID, TeamID: t.TeamID, Units: t.Units, Value: value,
		})
	}

	sort.Slice(parts, func(i, j int) bool {
		a, b := parts[i], parts[j]
		if a.SupplierID != b.SupplierID {
			return a.SupplierID < b.SupplierID
		}

		if a.ProductID != b.ProductID {
			return a.ProductID < b.ProductID
		}

		return a.TeamID < b.TeamID
	})

	return parts
}
