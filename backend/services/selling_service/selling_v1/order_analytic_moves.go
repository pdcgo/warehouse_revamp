package selling_v1

import (
	"fmt"

	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ORDER STATUS MOVES (docs/business/analytic/rpc_provide_decision.md#the-order-status-moves-prototype-is-accepted) —
// ONE metric, `metrics/orders/moves`, with a COUNT per status an order moved TO on its way out, each named by what
// happened to the order (the-order-metric-ids-name-what-moved). Every move publishes OrderStatusChanged; the fold counts
// it on the move's own Jakarta day (a-fact-counts-on-the-day-it-happened) under the order's seller, shop (as of the
// move), warehouse and CREATOR (a-metrics-user-is-the-orders-creator), as one `metric` value of order_daily_reports per
// count (selling 00052) — the shape Warehouse Fee already has, so the five's reads, re-fold and shop fix serve it.
//
// COUNTS ONLY: no money field, and a row's `total` and `mp_total` stay 0 (lost-is-a-metric-and-completed-is-not, its
// 2026-11-18 line — what was paid stays settlement's answer). So a warehouse reads every field of the orders it ships.
//
// DISPUTES RESOLVED (the accept's 🔄 2026-11-20 line — the owner's checklist, analytic/order_metric.md given 14,
// *disputes resolved shown*): an 8th count, the resolves alone — a move INTO completed straight from problem. It is
// counted BESIDE Completed, never instead of it: a resolve is one Completed (as accepted, so no figure already shown
// changes) AND one Disputes resolved, on the resolve's own Jakarta day, in the same transaction and under the same keys.
// Whether a move into completed is a resolve is read off the order's TIMELINE — its previous status row is problem
// (resolveSQL) — by the fold, the re-fold and a shop fix alike, so the three cannot disagree.

// The report's `metric` values of Order status moves, one per count.
const (
	reportMovesConfirmed     = "moves_confirmed"
	reportMovesBackToPending = "moves_back_to_pending"
	reportMovesPicked        = "moves_picked"
	reportMovesHandedOver    = "moves_handed_over"
	reportMovesShipped       = "moves_shipped"
	reportMovesProblem       = "moves_problem"
	reportMovesCompleted     = "moves_completed"
	// The resolves alone (problem → completed), counted beside moves_completed (selling 00053).
	reportMovesDisputesResolved = "moves_disputes_resolved"
)

// orderMoveCount is one count of Order status moves: the status the order moved INTO, its report value and its proto
// field. `from` is set on a count that names where the order came FROM too (Disputes resolved) — such a count is
// counted BESIDE the count of its status, never instead of it (resolveSQL decides which moves).
type orderMoveCount struct {
	status string
	from   string
	report string
	field  string
}

// orderMoveCounts is the eight, in the order an order moves — the proto's field order:
//
//	Confirmed        pending → processed
//	Back to pending  processed or picked → pending (never the placement's own pending row — that is Order Created)
//	Picked           processed → picked
//	Handed over      picked → shipping
//	Shipped          shipping → shipped
//	Problem          shipped → problem
//	Completed        shipped → completed, and a resolve: problem → completed
//	Disputes resolved  a resolve, problem → completed — ALSO a Completed (the accept's 2026-11-20 line)
//
// The moves into cancel, return, return_completed and lost are the five's own metrics, not counted here.
var orderMoveCounts = []orderMoveCount{
	{status: orderStatusProcessed, report: reportMovesConfirmed, field: "confirmed_count"},
	{status: orderStatusPending, report: reportMovesBackToPending, field: "back_to_pending_count"},
	{status: orderStatusPicked, report: reportMovesPicked, field: "picked_count"},
	{status: orderStatusShipping, report: reportMovesHandedOver, field: "handed_over_count"},
	{status: orderStatusShipped, report: reportMovesShipped, field: "shipped_count"},
	{status: orderStatusProblem, report: reportMovesProblem, field: "problem_count"},
	{status: orderStatusCompleted, report: reportMovesCompleted, field: "completed_count"},
	{status: orderStatusCompleted, from: orderStatusProblem, report: reportMovesDisputesResolved, field: "disputes_resolved_count"},
}

// moveReportOf is the Order status moves count a move INTO `status` goes to — false for a status it does not count.
// A count that also names a `from` is never this one: it rides beside it (alsoCounted).
func moveReportOf(status string) (string, bool) {
	for _, count := range orderMoveCounts {
		if count.status == status && count.from == "" {
			return count.report, true
		}
	}

	return "", false
}

// moveStatusOf is the status a count's moves went INTO — "" for a report value that is not one of the eight.
func moveStatusOf(report string) string {
	for _, count := range orderMoveCounts {
		if count.report == report {
			return count.status
		}
	}

	return ""
}

func isMoveReport(report string) bool {
	return moveStatusOf(report) != ""
}

// moveFigures is what ONE move adds to its row: the order, and — on the five — its frozen `total_cost` and its
// `platform_total` (a-total-is-the-total-cost). A status move is a count alone.
func moveFigures(report string, totalCost, platformTotal float64) selling_service_models.OrderMetricColumns {
	if isMoveReport(report) {
		return selling_service_models.OrderMetricColumns{OrderCount: 1}
	}

	return selling_service_models.OrderMetricColumns{OrderCount: 1, Total: totalCost, MpTotal: platformTotal}
}

// afterThePlacementSQL is true of a timeline row (alias %[1]s) that is NOT the order's first status row. The
// placement writes the order's first row INTO pending (order_place.go), and it is Order Created's — a row into pending
// after an earlier status row is a hand back, a Back to pending. Shared by the re-fold's day read and a shop fix's
// counts, so the two cannot disagree on which pending rows are moves.
const afterThePlacementSQL = `EXISTS (SELECT 1 FROM order_timeline_logs p
        WHERE p.order_id = %[1]s.order_id AND p.id < %[1]s.id AND p.status <> '')`

func afterThePlacement(alias string) string {
	return fmt.Sprintf(afterThePlacementSQL, alias)
}

// resolveSQL is true of a timeline row (alias %[1]s) that is a RESOLVE — a move INTO completed whose previous STATUS
// row (a note has no status) is problem. Every status move writes its row under the order's row lock, so the previous
// status row is the status the order moved from. The CASE keeps the lookup to the rows into completed, so a day of other
// moves pays nothing for it. Named args @completed and @problem (moveStatusArgs). Shared by the fold, the re-fold's day
// read and a shop fix's counts, so the three cannot disagree on which completed moves are resolves.
const resolveSQL = `CASE WHEN %[1]s.status = @completed THEN COALESCE((SELECT p.status FROM order_timeline_logs p
        WHERE p.order_id = %[1]s.order_id AND p.id < %[1]s.id AND p.status <> ''
        ORDER BY p.id DESC LIMIT 1) = @problem, false) ELSE false END`

func isAResolve(alias string) string {
	return fmt.Sprintf(resolveSQL, alias)
}

// resolvedAt says whether the move on timeline row `logID` is a resolve (resolveSQL) — false for a row it cannot find.
func resolvedAt(tx *gorm.DB, logID uint64) (bool, error) {
	var resolve []bool

	err := tx.
		Raw(`SELECT `+isAResolve("l")+` FROM order_timeline_logs l WHERE l.id = @log`,
			moveStatusArgs(map[string]any{"log": logID})).
		Scan(&resolve).
		Error
	if err != nil {
		return false, err
	}

	return len(resolve) == 1 && resolve[0], nil
}

// ordersMovesMetric is Order status moves as this service serves it: its eight fields, each the `order_count` of its
// own report value. Read off the proto at startup — a field the table above does not map is a programming error.
func ordersMovesMetric() *orderMetric {
	metric := newMetricOf("moves", &sellingv1.OrderMovesMetric{})

	numbers := san_metric.Fields(metric.desc)
	if len(numbers) != len(orderMoveCounts) {
		panic(fmt.Sprintf("order metrics: OrderMovesMetric has %d number fields, the moves table %d", len(numbers),
			len(orderMoveCounts)))
	}

	for _, count := range orderMoveCounts {
		field := metric.desc.Fields().ByName(protoName(count.field))
		if field == nil {
			panic("order metrics: OrderMovesMetric has no field " + count.field)
		}

		metric.reports = append(metric.reports, count.report)
		metric.fields = append(metric.fields, metricField{desc: field, report: count.report, column: columnOrderCount})
	}

	// Counts only: a warehouse reads every field (a-warehouse-reads-the-orders-it-ships) — nothing here is money.
	for _, number := range numbers {
		if number.StatType == analytic_basev1.FieldStatType_FIELD_STAT_TYPE_CURRENCY {
			panic("order metrics: Order status moves is counts only, but " + number.Name + " is money")
		}
	}

	return metric
}
