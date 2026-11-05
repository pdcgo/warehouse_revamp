package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The report's `metric` values — one per order metric.
const (
	reportCreated       = "created"
	reportCancelled     = "cancelled"
	reportReturnCreated = "return_created"
	reportReturnArrived = "return_arrived"
	reportLostCreated   = "lost_created"
	// WAREHOUSE FEE (the-warehouse-fee-prototype-is-accepted) — not a move of its own: the created and cancelled folds
	// each write it a SIGNED row beside their own (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day).
	reportWarehouseFee = "warehouse_fee"
)

// FoldHandler is the order metrics' push handler: it folds OrderPlaced, OrderCancelled, OrderStatusChanged and
// OrderReturnAccepted into `order_daily_reports` (a-report-is-fed-by-events-only-for-now). One handler behind four
// subscriptions — one per topic — because a subscription reads one topic.
//
// A move no metric counts (a confirm, a handover, a completed) and any other variant are ACKED: redelivering a message
// nothing here will ever count is a loop, not a retry.
func (a *Analytic) FoldHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		metric, orderID := foldTarget(event)
		if metric == "" {
			return nil
		}

		return a.fold(ctx, event, metric, orderID)
	}
}

// foldTarget is which metric an event counts for, and its order — "" when it counts for none.
func foldTarget(event *eventsv1.Event) (string, uint64) {
	switch {
	case event.GetOrderPlaced() != nil:
		return reportCreated, event.GetOrderPlaced().GetOrderId()
	case event.GetOrderCancelled() != nil:
		return reportCancelled, event.GetOrderCancelled().GetOrderId()
	case event.GetOrderReturnAccepted() != nil:
		// The move into `return_completed` is the return accept's own event — OrderStatusChange refuses that move, so
		// OrderStatusChanged never carries it.
		return reportReturnArrived, event.GetOrderReturnAccepted().GetOrderId()
	case event.GetOrderStatusChanged() != nil:
		moved := event.GetOrderStatusChanged()

		switch moved.GetToStatus() {
		case orderStatusReturn:
			return reportReturnCreated, moved.GetOrderId()
		case orderStatusLost:
			return reportLostCreated, moved.GetOrderId()
		}
	}

	return "", 0
}

// fold counts ONE order into its day's row for one metric.
//
// The DAY is the event's own instant as a Jakarta date — the placement, the cancel or the move
// (a-fact-counts-on-the-day-it-happened). Everything else is read off the ORDER, which this service owns: its seller,
// shop, warehouse and creator, its frozen `total_cost` and its `platform_total` (a-total-is-the-total-cost) — none of
// which change after the order is placed, so reading them now is reading them then.
//
// ⚠ ONE TRANSACTION for the claim and the upsert. A failure rolls the claim back with the figures, so the redelivery
// genuinely reprocesses rather than being recognised as "already done" with nothing counted.
//
// WAREHOUSE FEE rides the same claim: a placement also adds +1 and + the order's frozen `warehouse_fee` to the fee row of
// the placement's day, and a cancel −1 and − the fee to the fee row of the CANCEL's day
// (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day) — the placement's day is never re-folded. An
// order with no fee (a server built without a pricer) writes no fee row, so its cancel takes nothing back. The fee row
// is always the transaction's SECOND lock, after the move's own row, so two folds never wait on each other in a cycle.
func (a *Analytic) fold(ctx context.Context, event *eventsv1.Event, metric string, orderID uint64) error {
	day := event.GetOccurredAt().AsTime().In(wib).Format(metricDateLayout)

	raw, err := san_event.Marshal(event)
	if err != nil {
		return err
	}

	return a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// THE CLAIM. Dedup is the write, never a predicate before it: rows affected 0 means this event was already
		// folded, and the transaction commits having written nothing.
		claim := tx.Exec(
			`INSERT INTO order_event_logs (id, raw, day) VALUES (?, ?, CAST(? AS date)) ON CONFLICT (id) DO NOTHING`,
			event.GetEventId(), raw, day,
		)
		if claim.Error != nil {
			return claim.Error
		}

		if claim.RowsAffected == 0 {
			return nil
		}

		var order selling_service_models.Order

		err := tx.
			Select("id", "team_id", "shop_id", "warehouse_id", "created_by_user_id", "total_cost", "platform_total",
				"warehouse_fee").
			Where("id = ?", orderID).
			Take(&order).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Nothing to count, and nothing will ever be: the claim stays, so a redelivery is ACKED too.
			slog.WarnContext(ctx, "order metrics: an event names an order this service does not have",
				"event_id", event.GetEventId(), "order_id", orderID)

			return nil
		}

		if err != nil {
			return err
		}

		err = addToReport(tx, day, metric, &order, selling_service_models.OrderMetricColumns{
			OrderCount: 1,
			Total:      order.TotalCost,
			MpTotal:    order.PlatformTotal,
		})
		if err != nil {
			return fmt.Errorf("order metrics: %s into %s on %s: %w", event.GetEventId(), metric, day, err)
		}

		fee, ok := feeMove(metric, order.WarehouseFee)
		if !ok {
			return nil
		}

		err = addToReport(tx, day, reportWarehouseFee, &order, fee)
		if err != nil {
			return fmt.Errorf("order metrics: %s into %s on %s: %w", event.GetEventId(), reportWarehouseFee, day, err)
		}

		return nil
	})
}

// feeMove is what a move does to Warehouse Fee: a placement adds its order's fee, a cancel takes it back; no other move
// touches it, nor does an order with no fee (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day).
func feeMove(metric string, warehouseFee *float64) (selling_service_models.OrderMetricColumns, bool) {
	if warehouseFee == nil {
		return selling_service_models.OrderMetricColumns{}, false
	}

	switch metric {
	case reportCreated:
		return selling_service_models.OrderMetricColumns{OrderCount: 1, Total: *warehouseFee}, true
	case reportCancelled:
		return selling_service_models.OrderMetricColumns{OrderCount: -1, Total: -*warehouseFee}, true
	default:
		return selling_service_models.OrderMetricColumns{}, false
	}
}

// addToReport ADDS `move` to the order's row of `metric` on `day`.
//
// ⚠ ONE ROW PER (day, metric, seller, shop, warehouse, creator): every figure is a sum of moves, so two moves on one day
// simply ADD — a signed one (a fee's cancel) subtracts. The row is locked by the upsert itself, so two folds into one row
// queue.
func addToReport(
	tx *gorm.DB,
	day, metric string,
	order *selling_service_models.Order,
	move selling_service_models.OrderMetricColumns,
) error {
	return tx.Exec(`
INSERT INTO order_daily_reports AS d (
    day, metric, team_id, shop_id, warehouse_id, user_id, order_count, total, mp_total, last_updated
)
VALUES (CAST(? AS date), ?, ?, ?, ?, ?, ?, ?, ?, NOW())
ON CONFLICT (day, metric, team_id, shop_id, warehouse_id, user_id) DO UPDATE
SET order_count  = d.order_count + EXCLUDED.order_count,
    total        = d.total + EXCLUDED.total,
    mp_total     = d.mp_total + EXCLUDED.mp_total,
    last_updated = NOW()`,
		day, metric, order.TeamID, order.ShopID, order.WarehouseID, order.CreatedByUserID,
		move.OrderCount, move.Total, move.MpTotal,
	).Error
}
