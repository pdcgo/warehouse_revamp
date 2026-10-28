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

// metricToProto is a summed row as the wire carries it, its broken rate computed from the same sums — never averaged
// from smaller rows' rates (every-metric-has-a-summary).
func metricToProto(m supplier_service_models.SupplierMetricColumns) *supplierv1.SupplierMetric {
	var rate float64

	units := m.RestockCount + m.ShippingLostCount + m.ShippingBrokenCount
	if units > 0 {
		rate = float64(m.ShippingBrokenCount) / float64(units)
	}

	return &supplierv1.SupplierMetric{
		RestockCount:            m.RestockCount,
		RestockValuation:        m.RestockValuation,
		ShippingLostCount:       m.ShippingLostCount,
		ShippingLostValuation:   m.ShippingLostValuation,
		ShippingBrokenCount:     m.ShippingBrokenCount,
		ShippingBrokenValuation: m.ShippingBrokenValuation,
		BrokenRate:              rate,
	}
}

var errBadDate = connect.NewError(connect.CodeInvalidArgument, errors.New("a date must be YYYY-MM-DD"))

func parseDate(raw string) (time.Time, error) {
	t, err := time.Parse(dateLayout, raw)
	if err != nil {
		return time.Time{}, errBadDate
	}

	return t, nil
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
