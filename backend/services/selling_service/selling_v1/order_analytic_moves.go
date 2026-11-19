package selling_v1

import (
	"fmt"

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

// The report's `metric` values of Order status moves, one per count.
const (
	reportMovesConfirmed     = "moves_confirmed"
	reportMovesBackToPending = "moves_back_to_pending"
	reportMovesPicked        = "moves_picked"
	reportMovesHandedOver    = "moves_handed_over"
	reportMovesShipped       = "moves_shipped"
	reportMovesProblem       = "moves_problem"
	reportMovesCompleted     = "moves_completed"
)

// orderMoveCount is one count of Order status moves: the status the order moved INTO, its report value and its proto
// field.
type orderMoveCount struct {
	status string
	report string
	field  string
}

// orderMoveCounts is the seven, in the order an order moves — the proto's field order:
//
//	Confirmed        pending → processed
//	Back to pending  processed or picked → pending (never the placement's own pending row — that is Order Created)
//	Picked           processed → picked
//	Handed over      picked → shipping
//	Shipped          shipping → shipped
//	Problem          shipped → problem
//	Completed        shipped → completed, and a resolve: problem → completed
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
}

// moveReportOf is the Order status moves count a move INTO `status` goes to — false for a status it does not count.
func moveReportOf(status string) (string, bool) {
	for _, count := range orderMoveCounts {
		if count.status == status {
			return count.report, true
		}
	}

	return "", false
}

// moveStatusOf is the status a count's moves went INTO — "" for a report value that is not one of the seven.
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

// ordersMovesMetric is Order status moves as this service serves it: its seven fields, each the `order_count` of its
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
