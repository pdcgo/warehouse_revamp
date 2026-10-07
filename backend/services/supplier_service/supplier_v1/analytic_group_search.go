package supplier_v1

import (
	"context"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// AnalyticGroupSearch RANKS suppliers over a window — the Supplier Report (the-figures-are-a-statistics-tab-and-a-supplier-report)
// — and returns every ranked supplier's total, the report's headline.
//
//   - Every team's restocks unless one restocking team is picked (the-team-filter-picks-any-selling-team).
//   - `q` finds suppliers as SupplierList does — name, address, contact, a live store's name
//     (the-supplier-report-searches-like-discover). supplier_service holds both tables, so it is a join, not a call.
//   - A DELETED supplier with figures in the window is ranked like any other (a-deleted-supplier-is-kept-for-its-figures).
//   - By broken rate, a supplier needs `rateMinUnits` units in the window to be rated against the others; the rest
//     follow (rate-ranking-needs-50-units).
//
// ONE statement: the window grouped by supplier once, then the page AND the totals over every group (window
// functions). A page past the end has no row to carry the totals, so only then a second statement asks for them
// (audits/services/supplier_service/performances/AnalyticGroupSearch.md — it was COUNT(DISTINCT), which sorted every
// row of the window).
func (s *Service) AnalyticGroupSearch(
	ctx context.Context,
	req *connect.Request[supplierv1.AnalyticGroupSearchRequest],
) (*connect.Response[supplierv1.AnalyticGroupSearchResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	page := msg.GetPage()

	start, end, err := parseRange(filter.GetDateRange())
	if err != nil {
		return nil, err
	}

	db := s.db.WithContext(ctx)

	type rankedRow struct {
		SupplierID uint64
		Suppliers  int64
		supplier_service_models.SupplierMetricColumns
	}

	var rows []rankedRow

	err = db.
		Table("(?) AS g", groupedBySupplier(db, start, end, filter)).
		Select("g.supplier_id, COUNT(*) OVER () AS suppliers, " + groupTotals("SUM(g.%[1]s) OVER ()")).
		Order(rankOrder(msg.GetSort())).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, internal(err)
	}

	ids := make([]uint64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.SupplierID)
	}

	var sum struct {
		Suppliers int64
		supplier_service_models.SupplierMetricColumns
	}

	if len(rows) > 0 {
		sum.Suppliers = rows[0].Suppliers
		sum.SupplierMetricColumns = rows[0].SupplierMetricColumns
	} else if page.GetPage() > 1 {
		// Past the last page: no row came back to carry the totals.
		err = db.
			Table("(?) AS g", groupedBySupplier(db, start, end, filter)).
			Select("COUNT(*) AS suppliers, " + groupTotals("COALESCE(SUM(g.%[1]s), 0)")).
			Scan(&sum).
			Error
		if err != nil {
			return nil, internal(err)
		}
	}

	return connect.NewResponse(&supplierv1.AnalyticGroupSearchResponse{
		Ids:          ids,
		PageInfo:     pageInfo(page, sum.Suppliers),
		Total:        metricToProto(sum.SupplierMetricColumns),
		RateMinUnits: rateMinUnits,
	}), nil
}

// groupedBySupplier is the window's figures per supplier the search finds — the six sums and the units the rate
// divides by. Built fresh for every statement: a GORM chain is not safe to reuse.
func groupedBySupplier(db *gorm.DB, start, end time.Time, filter *supplierv1.AnalyticGroupFilter) *gorm.DB {
	query := window(db, start, end, filter.GetRestockTeamId())

	if pattern := likePattern(filter.GetQ()); pattern != "" {
		query = query.
			Joins("JOIN suppliers s ON s.id = r.supplier_id").
			Where(
				"s.name ILIKE ? OR s.address ILIKE ? OR s.contact ILIKE ? OR EXISTS ("+
					"SELECT 1 FROM supplier_channels c "+
					"WHERE c.supplier_id = s.id AND c.deleted_at IS NULL AND c.name ILIKE ?)",
				pattern, pattern, pattern, pattern,
			)
	}

	return query.
		Select("r.supplier_id, " + figureSums("r") + ", " + unitsSum("r") + " AS units").
		Group("r.supplier_id")
}

// groupTotals renders the six figures over the groups with one aggregate shape — "SUM(g.%[1]s) OVER ()" for the page
// statement, "COALESCE(SUM(g.%[1]s), 0)" for the totals alone — each cast back to bigint and named as its column.
func groupTotals(shape string) string {
	parts := make([]string, 0, len(figureColumns))

	for _, column := range figureColumns {
		parts = append(parts, fmt.Sprintf("("+shape+")::bigint AS %[1]s", column))
	}

	return strings.Join(parts, ", ")
}

// rankOrder is the ranking's ORDER BY over the grouped rows. Every order ends on the supplier's id, so a page boundary
// is stable.
func rankOrder(sort supplierv1.AnalyticGroupSort) string {
	if sort != supplierv1.AnalyticGroupSort_ANALYTIC_GROUP_SORT_BROKEN_RATE {
		return "g.restock_valuation DESC, g.supplier_id"
	}

	// The rated first — at least rateMinUnits units — by rate; then the rest, by rate; ties by value. A ranked supplier
	// always received something (a row is written only when a line counted units), so the divisor is never 0 — NULLIF
	// keeps that a property of the query rather than of the fold.
	return fmt.Sprintf(
		"(g.units >= %d) DESC, g.shipping_broken_count::numeric / NULLIF(g.units, 0) DESC NULLS LAST, "+
			"g.restock_valuation DESC, g.supplier_id",
		rateMinUnits,
	)
}
