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

// restockColumns are the six figures (each-figure-is-read-at-the-accept), in SupplierMetric order — the columns of
// `supplier_product_daily_reports`.
var restockColumns = []string{
	"restock_count",
	"restock_valuation",
	"shipping_lost_count",
	"shipping_lost_valuation",
	"shipping_broken_count",
	"shipping_broken_valuation",
}

// salesColumns are Penjualan's two (penjualan-is-the-selling-value-on-the-order-day) — the columns of
// `supplier_sale_daily_reports`.
var salesColumns = []string{
	"sales_count",
	"sales_value",
}

// sumsOf renders "COALESCE(SUM(r.restock_count), 0) AS restock_count, …" over a report alias. Every summed read renders
// its SELECT list from restockColumns or salesColumns, so a column cannot be summed in one read and forgotten in the next.
func sumsOf(alias string, columns []string) string {
	parts := make([]string, 0, len(columns))

	for _, column := range columns {
		parts = append(parts, fmt.Sprintf("COALESCE(SUM(%s.%s), 0) AS %s", alias, column, column))
	}

	return strings.Join(parts, ", ")
}

// figureSums are the six restock figures over `supplier_product_daily_reports`.
func figureSums(alias string) string {
	return sumsOf(alias, restockColumns)
}

// salesSums are Penjualan's two over `supplier_sale_daily_reports`.
func salesSums(alias string) string {
	return sumsOf(alias, salesColumns)
}

// zerosOf renders "0::bigint AS restock_count, 0::double precision AS restock_valuation, …" — the columns the other
// table does not have, so a UNION ALL of the two grouped reads lines up. A count is a bigint, a value a double.
func zerosOf(columns []string) string {
	parts := make([]string, 0, len(columns))

	for _, column := range columns {
		kind := "bigint"
		if !strings.HasSuffix(column, "_count") {
			kind = "double precision"
		}

		parts = append(parts, fmt.Sprintf("0::%s AS %s", kind, column))
	}

	return strings.Join(parts, ", ")
}

// addRestock folds a restock read into a sum of the same key — a sales read carries zeros here, so it adds nothing.
func addRestock(sums, read supplier_service_models.SupplierFigureSums) supplier_service_models.SupplierFigureSums {
	sums.RestockCount += read.RestockCount
	sums.RestockValuation += read.RestockValuation
	sums.ShippingLostCount += read.ShippingLostCount
	sums.ShippingLostValuation += read.ShippingLostValuation
	sums.ShippingBrokenCount += read.ShippingBrokenCount
	sums.ShippingBrokenValuation += read.ShippingBrokenValuation

	return sums
}

// withSales folds a sales read into a restock read of the same key — a restock read carries zero sales.
func withSales(sums supplier_service_models.SupplierFigureSums, sales supplier_service_models.SupplierFigureSums) supplier_service_models.SupplierFigureSums {
	sums.SalesCount += sales.SalesCount
	sums.SalesValue += sales.SalesValue

	return sums
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

// float64Array is int64Array for money: a Postgres double precision[] literal, each value written in full
// (strconv 'g', -1 — the shortest text that reads back as the same double).
func float64Array(values []float64) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, strconv.FormatFloat(v, 'g', -1, 64))
	}

	return "{" + strings.Join(parts, ",") + "}"
}

// unitsSum is every unit that came off the supplier — restocked + lost + broken — the broken rate's denominator.
func unitsSum(alias string) string {
	return fmt.Sprintf("COALESCE(SUM(%[1]s.restock_count + %[1]s.shipping_lost_count + %[1]s.shipping_broken_count), 0)", alias)
}

// metricToProto is a summed row as the wire carries it, its broken rate computed from the same sums — never averaged
// from smaller rows' rates (every-metric-has-a-summary).
func metricToProto(sums supplier_service_models.SupplierFigureSums) *supplierv1.SupplierMetric {
	m := sums.SupplierMetricColumns

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
		SalesCount:              sums.SalesCount,
		SalesValue:              sums.SalesValue,
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

// window narrows ONE report table — the restock rows, or Penjualan's (00004), which share their key: day, supplier,
// product, team — to a window, and to one restocking team when one is picked (the-team-filter-picks-any-selling-team).
// The team of a sale is the team that owns the goods, the restocking team.
//
// ⚠ EACH TABLE IS READ ON ITS OWN and the two summed after — in Go for a fill, in one UNION ALL of the two GROUPED reads
// for a ranking — never as a UNION ALL of their rows: under one aggregate Postgres plans that as a Parallel Append, and
// on a 30-day headline the workers' start-up alone took it from 9 to 40 ms (audits/services/supplier_service/
// performances/SalesFold.md).
//
// ⚠ THE TWO DATES ARE LITERALS, NOT PARAMETERS
// (audits/services/supplier_service/performances/AnalyticGroupSearch.md, finding 2). The driver prepares every
// statement, and after five executions Postgres may plan a parameterised window ONCE, for any dates — mostly from the
// screen's 30-day default — and then read a year through a plan sized for a few thousand rows: a 33 MB disk sort, a
// second instead of a tenth of one. A literal gives each window its own plan. SAFE: both strings are formatted HERE from
// a parsed time.Time, so they can only be digits and dashes — nothing typed reaches the SQL. And they are dates, never
// a Go time.Time, which would compare as a timestamptz and move the boundary by the session's offset.
func window(tx *gorm.DB, table string, start, end time.Time, restockTeamID uint64) *gorm.DB {
	query := tx.
		Table(table+" AS r").
		Where(fmt.Sprintf("r.day BETWEEN DATE '%s' AND DATE '%s'", start.Format(dateLayout), end.Format(dateLayout)))

	if restockTeamID != 0 {
		query = query.Where("r.team_id = ?", restockTeamID)
	}

	return query
}

const (
	restockTable = "supplier_product_daily_reports"
	salesTable   = "supplier_sale_daily_reports"
)
