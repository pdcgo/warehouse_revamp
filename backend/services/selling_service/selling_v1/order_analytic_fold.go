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

// FoldHandler is the order metrics' push handler: it folds OrderPlaced, OrderCancelled, OrderStatusChanged,
// OrderReturnAccepted and OrderShopChanged into `order_daily_reports` (a-report-is-fed-by-events-only-for-now). One
// handler behind five subscriptions — one per topic — because a subscription reads one topic.
//
// Every OrderStatusChanged counts for one metric now: a move into return or lost for the five's, every other move along
// the order's way out for one count of Order status moves (the-order-status-moves-prototype-is-accepted) — and a resolve
// (problem → completed) for a second count beside its Completed, Disputes resolved (the accept's 2026-11-20 line). A
// status no metric counts and any other variant are ACKED: redelivering a message nothing here will ever count is a
// loop, not a retry.
func (a *Analytic) FoldHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		// A FIX OF THE ORDER'S SHOP is not one metric's move: it carries every metric the order had counted over to the
		// new shop, on the day of the fix (an-orders-shop-is-fixed-and-counted-on-the-day).
		fixed := event.GetOrderShopChanged()
		if fixed != nil {
			return a.foldShopFix(ctx, event, fixed)
		}

		target := foldTarget(event)
		if target.metric == "" {
			return nil
		}

		return a.fold(ctx, event, target)
	}
}

// foldMove is which metric an event counts for, its order, and the timeline row it was built from — the row whose
// shop it counts under (shopAsOf). logID is 0 for the placement, which comes before every row; current says the
// order's shop now is the move's (a cancel — see shopAsOf).
type foldMove struct {
	metric  string
	orderID uint64
	logID   uint64
	current bool
}

// foldTarget is which metric an event counts for — an empty metric when it counts for none.
func foldTarget(event *eventsv1.Event) foldMove {
	switch {
	case event.GetOrderPlaced() != nil:
		return foldMove{metric: reportCreated, orderID: event.GetOrderPlaced().GetOrderId()}
	case event.GetOrderCancelled() != nil:
		return foldMove{metric: reportCancelled, orderID: event.GetOrderCancelled().GetOrderId(), current: true}
	case event.GetOrderReturnAccepted() != nil:
		// The move into `return_completed` is the return accept's own event — OrderStatusChange refuses that move, so
		// OrderStatusChanged never carries it.
		accepted := event.GetOrderReturnAccepted()

		return foldMove{metric: reportReturnArrived, orderID: accepted.GetOrderId(), logID: accepted.GetTimelineLogId()}
	case event.GetOrderStatusChanged() != nil:
		moved := event.GetOrderStatusChanged()

		switch moved.GetToStatus() {
		case orderStatusReturn:
			return foldMove{metric: reportReturnCreated, orderID: moved.GetOrderId(), logID: moved.GetTimelineLogId()}
		case orderStatusLost:
			return foldMove{metric: reportLostCreated, orderID: moved.GetOrderId(), logID: moved.GetTimelineLogId()}
		}

		// ORDER STATUS MOVES — named by the status the order moved TO (the-order-metric-ids-name-what-moved): a resolve
		// is a Completed (and a Disputes resolved beside it — fold), a hand back from processed or picked a Back to
		// pending. The placement publishes OrderPlaced, never this, so a move into pending here is always a hand back.
		report, ok := moveReportOf(moved.GetToStatus())
		if ok {
			return foldMove{metric: report, orderID: moved.GetOrderId(), logID: moved.GetTimelineLogId()}
		}
	}

	return foldMove{}
}

// fold counts ONE order into its day's row for one metric.
//
// The DAY is the event's own instant as a Jakarta date — the placement, the cancel or the move
// (a-fact-counts-on-the-day-it-happened). Everything else is read off the ORDER, which this service owns: its seller,
// warehouse and creator, its frozen `total_cost` and its `platform_total` (a-total-is-the-total-cost) — none of which
// change after the order is placed, so reading them now is reading them then. A status move of Order status moves adds
// the count alone, no money (moveFigures). Its SHOP can be fixed
// (an-orders-shop-is-fixed-and-counted-on-the-day), so the move counts under the shop the order was in at the move
// (shopAsOf) — a late event never lands on a shop the order only moved to later.
//
// A RESOLVE counts twice (the-order-status-moves-prototype-is-accepted, its 2026-11-20 line): a move into completed
// whose previous status row on the timeline is problem (resolvedAt — the re-fold's and a shop fix's own rule) adds +1 to
// Disputes resolved too, on the same day under the same keys, as the transaction's second lock after the Completed row
// (metricLockRank). Its Completed is counted exactly as before.
//
// ⚠ ONE TRANSACTION for the claim and the upsert. A failure rolls the claim back with the figures, so the redelivery
// genuinely reprocesses rather than being recognised as "already done" with nothing counted.
//
// WAREHOUSE FEE rides the same claim: a placement also adds +1 and + the order's frozen `warehouse_fee` to the fee row of
// the placement's day, and a cancel −1 and − the fee to the fee row of the CANCEL's day
// (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day) — the placement's day is never re-folded. An
// order with no fee (a server built without a pricer) writes no fee row, so its cancel takes nothing back. The fee row
// is always the transaction's SECOND lock, after the move's own row, so two folds never wait on each other in a cycle.
func (a *Analytic) fold(ctx context.Context, event *eventsv1.Event, target foldMove) error {
	metric, orderID := target.metric, target.orderID
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

		if !target.current {
			order.ShopID, err = shopAsOf(tx, &order, target.logID)
			if err != nil {
				return fmt.Errorf("order metrics: %s's shop at the move: %w", event.GetEventId(), err)
			}
		}

		err = addToReport(tx, day, metric, &order, moveFigures(metric, order.TotalCost, order.PlatformTotal))
		if err != nil {
			return fmt.Errorf("order metrics: %s into %s on %s: %w", event.GetEventId(), metric, day, err)
		}

		if metric == reportMovesCompleted {
			return addTheResolve(tx, event, day, &order, target.logID)
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

// foldShopFix counts a FIX OF THE ORDER'S SHOP on the day of the fix (an-orders-shop-is-fixed-and-counted-on-the-day):
// every metric the order had been counted in before the fix — its placement, and its moves on the timeline before the
// fix's note row — −1 with the order's figures under the old shop and +1 under the new (shopMoveRows). Past days are
// never touched, and a move committed after the fix counts under the new shop by its own event.
//
// One transaction for the claim and every row, as fold's; the rows are written in metricLockRank's order, the fee row
// last, so a fix and an ordinary fold never wait on each other in a cycle.
func (a *Analytic) foldShopFix(ctx context.Context, event *eventsv1.Event, fixed *eventsv1.OrderShopChanged) error {
	day := event.GetOccurredAt().AsTime().In(wib).Format(metricDateLayout)

	raw, err := san_event.Marshal(event)
	if err != nil {
		return err
	}

	return a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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
			Where("id = ?", fixed.GetOrderId()).
			Take(&order).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.WarnContext(ctx, "order metrics: a shop fix names an order this service does not have",
				"event_id", event.GetEventId(), "order_id", fixed.GetOrderId())

			return nil
		}

		if err != nil {
			return err
		}

		counts, err := countsBeforeShopFix(tx, order.ID, fixed.GetTimelineLogId())
		if err != nil {
			return fmt.Errorf("order metrics: %s's moves before the fix: %w", event.GetEventId(), err)
		}

		for _, row := range shopMoveRows(&order, fixed.GetFromShopId(), fixed.GetToShopId(), counts) {
			order.ShopID = row.ShopID

			err = addToReport(tx, day, row.Metric, &order, row.Columns)
			if err != nil {
				return fmt.Errorf("order metrics: %s into %s on %s: %w", event.GetEventId(), row.Metric, day, err)
			}
		}

		return nil
	})
}

// addTheResolve counts a Completed's SECOND count when it is a resolve (resolvedAt): +1 Disputes resolved on the same
// day under the same keys. Any other completed adds nothing more. A completed touches no fee row.
func addTheResolve(tx *gorm.DB, event *eventsv1.Event, day string, order *selling_service_models.Order, logID uint64) error {
	resolve, err := resolvedAt(tx, logID)
	if err != nil {
		return fmt.Errorf("order metrics: is %s a resolve: %w", event.GetEventId(), err)
	}

	if !resolve {
		return nil
	}

	err = addToReport(tx, day, reportMovesDisputesResolved, order,
		moveFigures(reportMovesDisputesResolved, order.TotalCost, order.PlatformTotal))
	if err != nil {
		return fmt.Errorf("order metrics: %s into %s on %s: %w", event.GetEventId(), reportMovesDisputesResolved, day, err)
	}

	return nil
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
