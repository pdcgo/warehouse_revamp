package selling_v1

import (
	"cmp"
	"slices"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// THE SHOP A MOVE COUNTS UNDER (an-orders-shop-is-fixed-and-counted-on-the-day): an order's shop can be fixed, so the
// order's one `shop_id` is the shop it is in NOW, not the one it was in when it moved. Every order metric counts a move
// under the shop the order was in at that move — so a past day keeps its shop through a fix, a late event and a re-fold
// alike (a-fact-counts-on-the-day-it-happened):
//
//	the placement            → the from-shop of the order's FIRST fix, or its shop now when it was never fixed
//	a move (timeline row L)  → the from-shop of the first fix whose note row comes after L, or its shop now
//
// Every timeline row of one order is written under the order's row lock, so the timeline ids order the moves and the
// fixes exactly. A cancel needs no lookup: it is pending's only move out, a fix is taken only from handover on
// (shopFixable), and no status from handover on leads back to pending — so no fix ever comes before or after a cancel,
// and the order's shop now is the shop it was cancelled in.

// shopAsOfSQL is the lookup, shared by the fold and the re-fold's per-move subquery so the two cannot disagree.
const shopAsOfSQL = `SELECT from_shop_id FROM order_shop_changes WHERE order_id = ? AND timeline_log_id > ?
ORDER BY timeline_log_id LIMIT 1`

// shopAsOf is the shop the order was in at its timeline row `logID` — 0 for the placement, which comes before every row.
func shopAsOf(tx *gorm.DB, order *selling_service_models.Order, logID uint64) (uint64, error) {
	var from []uint64

	err := tx.
		Raw(shopAsOfSQL, order.ID, logID).
		Scan(&from).
		Error
	if err != nil {
		return 0, err
	}

	if len(from) == 0 {
		return order.ShopID, nil
	}

	return from[0], nil
}

// THE MOVE A FIX COUNTS: what the order had been counted in before the fix — its placement, and every move into a
// counted status on its timeline before the fix's note row — taken out of the old shop and put into the new, on the
// day of the fix, with the order's own frozen figures. Past days are never touched.

// shopMoveCounts is how many times the order had been counted in each moving metric before a fix — the four moving
// order metrics, and each count of Order status moves (the-order-status-moves-prototype-is-accepted).
type shopMoveCounts struct {
	Cancelled     int64
	ReturnCreated int64
	ReturnArrived int64
	LostCreated   int64

	Confirmed     int64
	BackToPending int64
	Picked        int64
	HandedOver    int64
	Shipped       int64
	Problem       int64
	Completed     int64
	// The resolves among the Completed (resolveSQL) — each counted in both, as the fold counts it.
	DisputesResolved int64
}

// ofMove is the count of one Order status moves report value.
func (c shopMoveCounts) ofMove(report string) int64 {
	switch report {
	case reportMovesConfirmed:
		return c.Confirmed
	case reportMovesBackToPending:
		return c.BackToPending
	case reportMovesPicked:
		return c.Picked
	case reportMovesHandedOver:
		return c.HandedOver
	case reportMovesShipped:
		return c.Shipped
	case reportMovesProblem:
		return c.Problem
	case reportMovesCompleted:
		return c.Completed
	case reportMovesDisputesResolved:
		return c.DisputesResolved
	default:
		return 0
	}
}

// shopMoveCountsColumns counts a timeline's rows (alias l) into each counted status — the rows each metric's event was
// built from (order_analytic_refold.go's log), so a fix carries over what the fold counted. A row into pending counts
// only after the placement's own (afterThePlacement), and a resolve counts as a Completed AND a Disputes resolved
// (resolveSQL). Shared by the fold's per-fix read and the re-fold's per-fix lateral, so the two cannot disagree.
var shopMoveCountsColumns = `COUNT(*) FILTER (WHERE l.status = @cancel)  AS cancelled,
       COUNT(*) FILTER (WHERE l.status = @return)  AS return_created,
       COUNT(*) FILTER (WHERE l.status = @arrived) AS return_arrived,
       COUNT(*) FILTER (WHERE l.status = @lost)    AS lost_created,
       COUNT(*) FILTER (WHERE l.status = @processed) AS confirmed,
       COUNT(*) FILTER (WHERE l.status = @pending AND ` + afterThePlacement("l") + `) AS back_to_pending,
       COUNT(*) FILTER (WHERE l.status = @picked)    AS picked,
       COUNT(*) FILTER (WHERE l.status = @shipping)  AS handed_over,
       COUNT(*) FILTER (WHERE l.status = @shipped)   AS shipped,
       COUNT(*) FILTER (WHERE l.status = @problem)   AS problem,
       COUNT(*) FILTER (WHERE l.status = @completed) AS completed,
       COUNT(*) FILTER (WHERE ` + isAResolve("l") + `) AS disputes_resolved`

// shopMoveCountsSQL is the counts of one order's timeline before the fix's note row.
var shopMoveCountsSQL = `
SELECT ` + shopMoveCountsColumns + `
FROM order_timeline_logs l
WHERE l.order_id = @order AND l.id < @before`

// moveStatusArgs are the statuses shopMoveCountsColumns names.
func moveStatusArgs(args map[string]any) map[string]any {
	args["cancel"] = orderStatusCancel
	args["return"] = orderStatusReturn
	args["arrived"] = orderStatusReturnCompleted
	args["lost"] = orderStatusLost
	args["processed"] = orderStatusProcessed
	args["pending"] = orderStatusPending
	args["picked"] = orderStatusPicked
	args["shipping"] = orderStatusShipping
	args["shipped"] = orderStatusShipped
	args["problem"] = orderStatusProblem
	args["completed"] = orderStatusCompleted

	return args
}

func countsBeforeShopFix(tx *gorm.DB, orderID, timelineLogID uint64) (shopMoveCounts, error) {
	var counts shopMoveCounts

	err := tx.
		Raw(shopMoveCountsSQL, moveStatusArgs(map[string]any{"order": orderID, "before": timelineLogID})).
		Scan(&counts).
		Error

	return counts, err
}

// shopMoveRow is one report row a fix writes: a metric under one shop, signed.
type shopMoveRow struct {
	Metric  string
	ShopID  uint64
	Columns selling_service_models.OrderMetricColumns
}

// metricLockRank is the order a transaction writes report rows in — the moves' own metrics first, then Order status
// moves' counts, Warehouse Fee LAST, as the fold has always taken it (its fee row is the second lock after the move's
// own). With every writer following (rank, shop), no two folds wait on each other in a cycle.
var metricLockRank = map[string]int{
	reportCreated:            0,
	reportCancelled:          1,
	reportReturnCreated:      2,
	reportReturnArrived:      3,
	reportLostCreated:        4,
	reportMovesConfirmed:     5,
	reportMovesBackToPending: 6,
	reportMovesPicked:        7,
	reportMovesHandedOver:    8,
	reportMovesShipped:       9,
	reportMovesProblem:       10,
	reportMovesCompleted:     11,
	// After the Completed row, as the fold writes a resolve's two rows.
	reportMovesDisputesResolved: 12,
	reportWarehouseFee:          13,
}

// shopMoveRows is the fix's report rows: for each metric the order had been counted in, −n under the old shop and +n
// under the new, each with n × the order's frozen figures — exactly what the fold had added for it (a count of Order
// status moves carries no money). Warehouse Fee moves its net: +1 at the placement, −1 for a cancel (an order with no
// fee writes none). Sorted in lock order.
func shopMoveRows(
	order *selling_service_models.Order,
	fromShopID, toShopID uint64,
	counts shopMoveCounts,
) []shopMoveRow {
	rows := []shopMoveRow{}

	add := func(metric string, n float64, cols selling_service_models.OrderMetricColumns) {
		if n == 0 {
			return
		}

		rows = append(rows,
			shopMoveRow{Metric: metric, ShopID: fromShopID, Columns: selling_service_models.OrderMetricColumns{
				OrderCount: -int64(n) * cols.OrderCount, Total: -n * cols.Total, MpTotal: -n * cols.MpTotal,
			}},
			shopMoveRow{Metric: metric, ShopID: toShopID, Columns: selling_service_models.OrderMetricColumns{
				OrderCount: int64(n) * cols.OrderCount, Total: n * cols.Total, MpTotal: n * cols.MpTotal,
			}},
		)
	}

	figures := selling_service_models.OrderMetricColumns{OrderCount: 1, Total: order.TotalCost, MpTotal: order.PlatformTotal}

	// The placement is always counted: a fix needs an order.
	add(reportCreated, 1, figures)
	add(reportCancelled, float64(counts.Cancelled), figures)
	add(reportReturnCreated, float64(counts.ReturnCreated), figures)
	add(reportReturnArrived, float64(counts.ReturnArrived), figures)
	add(reportLostCreated, float64(counts.LostCreated), figures)

	for _, move := range orderMoveCounts {
		add(move.report, float64(counts.ofMove(move.report)), moveFigures(move.report, order.TotalCost, order.PlatformTotal))
	}

	if order.WarehouseFee != nil {
		add(reportWarehouseFee, float64(1-counts.Cancelled),
			selling_service_models.OrderMetricColumns{OrderCount: 1, Total: *order.WarehouseFee})
	}

	slices.SortFunc(rows, func(a, b shopMoveRow) int {
		return cmp.Or(
			cmp.Compare(metricLockRank[a.Metric], metricLockRank[b.Metric]),
			cmp.Compare(a.ShopID, b.ShopID),
		)
	})

	return rows
}
