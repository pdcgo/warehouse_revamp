package supplier_v1

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// jakarta is the system's calendar (the-system-runs-on-jakarta-time). Fixed +7: WIB has no daylight saving, and a
// fixed zone needs no tzdata on the host.
var jakarta = time.FixedZone("WIB", 7*60*60)

const dateLayout = "2006-01-02"

// rateMinUnits is how many units a supplier needs in a window to be ranked by its broken rate
// (rate-ranking-needs-50-units). Sent to the screen on every ranking, so it is stated here once.
const rateMinUnits = 50

// figureColumns are the six figures (each-figure-is-read-at-the-accept), in SupplierMetric order. Every summed read
// renders its SELECT list from this, so a column cannot be summed in one read and forgotten in the next.
var figureColumns = []string{
	"restock_count",
	"restock_valuation",
	"shipping_lost_count",
	"shipping_lost_valuation",
	"shipping_broken_count",
	"shipping_broken_valuation",
}

// figureSums renders "COALESCE(SUM(r.restock_count), 0) AS restock_count, …" over a report alias.
func figureSums(alias string) string {
	parts := make([]string, 0, len(figureColumns))

	for _, column := range figureColumns {
		parts = append(parts, fmt.Sprintf("COALESCE(SUM(%s.%s), 0) AS %s", alias, column, column))
	}

	return strings.Join(parts, ", ")
}

// int64Array renders a Postgres array literal — "{1,2,3}" — passed as ONE parameter and cast in SQL. ⚠ Not a Go slice:
// GORM expands a slice argument into a comma list, which is right for IN and wrong for an array.
func int64Array(values []int64) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, strconv.FormatInt(v, 10))
	}

	return "{" + strings.Join(parts, ",") + "}"
}

// unitsSum is every unit that came off the supplier — restocked + lost + broken — the broken rate's denominator.
func unitsSum(alias string) string {
	return fmt.Sprintf("COALESCE(SUM(%[1]s.restock_count + %[1]s.shipping_lost_count + %[1]s.shipping_broken_count), 0)", alias)
}

func metricToProto(m supplier_service_models.SupplierMetricColumns) *supplierv1.SupplierMetric {
	return &supplierv1.SupplierMetric{
		RestockCount:            m.RestockCount,
		RestockValuation:        m.RestockValuation,
		ShippingLostCount:       m.ShippingLostCount,
		ShippingLostValuation:   m.ShippingLostValuation,
		ShippingBrokenCount:     m.ShippingBrokenCount,
		ShippingBrokenValuation: m.ShippingBrokenValuation,
	}
}

var (
	errBadDate = connect.NewError(connect.CodeInvalidArgument, errors.New("a date must be YYYY-MM-DD"))

	errRangeBackwards = connect.NewError(
		connect.CodeInvalidArgument,
		errors.New("start_date must not be after end_date"),
	)

	errBadTimeframe = connect.NewError(connect.CodeInvalidArgument, errors.New("unknown timeframe"))
)

func parseDate(raw string) (time.Time, error) {
	t, err := time.Parse(dateLayout, raw)
	if err != nil {
		return time.Time{}, errBadDate
	}

	return t, nil
}

// parseRange reads a figures window. Both ends are required and inclusive.
func parseRange(r *supplierv1.AnalyticDateRange) (time.Time, time.Time, error) {
	start, err := parseDate(r.GetStartDate())
	if err != nil {
		return time.Time{}, time.Time{}, err
	}

	end, err := parseDate(r.GetEndDate())
	if err != nil {
		return time.Time{}, time.Time{}, err
	}

	if start.After(end) {
		return time.Time{}, time.Time{}, errRangeBackwards
	}

	return start, end, nil
}

// window narrows the report table to a window, and to one restocking team when one is picked
// (the-team-filter-picks-any-selling-team).
//
// ⚠ THE TWO DATES ARE LITERALS, NOT PARAMETERS
// (audits/services/supplier_service/performances/AnalyticGroupSearch.md, finding 2). The driver prepares every
// statement, and after five executions Postgres may plan a parameterised window ONCE, for any dates — mostly from the
// screen's 30-day default — and then read a year through a plan sized for a few thousand rows: a 33 MB disk sort, a
// second instead of a tenth of one. A literal gives each window its own plan. SAFE: both strings are formatted HERE from
// a parsed time.Time, so they can only be digits and dashes — nothing typed reaches the SQL. And they are dates, never
// a Go time.Time, which would compare as a timestamptz and move the boundary by the session's offset.
func window(tx *gorm.DB, start, end time.Time, restockTeamID uint64) *gorm.DB {
	query := tx.
		Table("supplier_product_daily_reports AS r").
		Where(fmt.Sprintf("r.day BETWEEN DATE '%s' AND DATE '%s'", start.Format(dateLayout), end.Format(dateLayout)))

	if restockTeamID != 0 {
		query = query.Where("r.team_id = ?", restockTeamID)
	}

	return query
}

// bucket is one point of a series: `at` is the bucket's own first day.
type bucket struct {
	at time.Time
}

// timeBuckets lays out EVERY bucket of the window, the quiet ones included. The span is capped per grain, so a
// coarser grain reaches further back: 366 days, 60 months, 20 years — settlement's caps, one rule for every report.
func timeBuckets(timeframe supplierv1.AnalyticTimeframe, start, end time.Time) ([]bucket, error) {
	var (
		first time.Time
		step  func(time.Time) time.Time
		limit int
	)

	switch timeframe {
	case supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY:
		first = start
		step = func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }
		limit = 366
	case supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_MONTHLY:
		first = time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
		step = func(t time.Time) time.Time { return t.AddDate(0, 1, 0) }
		limit = 60
	case supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_YEARLY:
		first = time.Date(start.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
		step = func(t time.Time) time.Time { return t.AddDate(1, 0, 0) }
		limit = 20
	default:
		return nil, errBadTimeframe
	}

	out := []bucket{}

	for at := first; !at.After(end); at = step(at) {
		if len(out) == limit {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("the window holds more than %d %s points — narrow it or read a coarser timeframe",
					limit, strings.ToLower(strings.TrimPrefix(timeframe.String(), "ANALYTIC_TIMEFRAME_"))))
		}

		out = append(out, bucket{at: at})
	}

	return out, nil
}

// truncUnit is the Postgres date_trunc unit of a timeframe — the bucket a day rolls up into.
func truncUnit(timeframe supplierv1.AnalyticTimeframe) string {
	switch timeframe {
	case supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_MONTHLY:
		return "month"
	case supplierv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_YEARLY:
		return "year"
	default:
		return "day"
	}
}
