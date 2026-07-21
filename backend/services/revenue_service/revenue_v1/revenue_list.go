package revenue_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_service_models"
)

// RevenueList returns what a team's orders were expected to make, newest first, paginated.
//
// The team_id clause IS the scope check — one team can never read another's margins by id, which
// matters more here than on most lists: this is the money.
func (s *Service) RevenueList(
	ctx context.Context,
	req *connect.Request[revenuev1.RevenueListRequest],
) (*connect.Response[revenuev1.RevenueListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&revenue_service_models.OrderRevenue{}).
		// EVERY row, voided ones included (#164).
		//
		// The list shows them and the TOTALS below exclude them, and that split is the whole point of
		// voiding rather than deleting: a cancelled order earned nothing, but the fact that it was placed
		// and then cancelled is exactly what somebody looking at the money wants to see. Hiding the row
		// here would make it as invisible as deleting it, which is the option the owner did not choose.
		Where("team_id = ?", req.Msg.GetTeamId())

	// THE PERIOD (#171). Applied to the list AND, below, to the totals — they must agree about what
	// the period contains, or the headline figure describes a different set of rows than the table.
	query, err := withPeriod(query, req.Msg.GetFrom(), req.Msg.GetTo())
	if err != nil {
		return nil, err
	}

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, revenueErr(err)
	}

	var rows []revenue_service_models.OrderRevenue

	err = query.
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, revenueErr(err)
	}

	out := make([]*revenuev1.OrderRevenue, 0, len(rows))
	for i := range rows {
		out = append(out, orderRevenueToProto(&rows[i]))
	}

	// The totals are over the WHOLE team, computed in the database — never by summing `rows`, which
	// holds one page. A page total is a different number wearing the same label: it would change with
	// the page size and be wrong in a way no reader could see.
	totals, err := teamTotals(ctx, s, req.Msg)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&revenuev1.RevenueListResponse{
		Revenues: out,
		PageInfo: pageInfo(page, total),
		Totals:   totals,
	}), nil
}

// totalsRow is the aggregate query's shape. COALESCE because SUM over no rows is NULL, and a team with
// no orders yet must read as zero rather than failing to scan.
type totalsRow struct {
	Revenue           int64
	Cogs              int64
	ShippingCost      int64
	ExpectedMargin    int64
	UnknownCostOrders int64
}

func teamTotals(
	ctx context.Context,
	s *Service,
	msg *revenuev1.RevenueListRequest,
) (*revenuev1.RevenueTotals, error) {
	var agg totalsRow

	query := s.db.
		WithContext(ctx).
		Model(&revenue_service_models.OrderRevenue{})

	// The SAME period the list used (#171). If these two ever disagree, the headline figure describes a
	// different set of rows than the table beneath it — which is the failure this filter exists to
	// prevent, so it must not be reintroduced by computing the two separately.
	query, err := withPeriod(query, msg.GetFrom(), msg.GetTo())
	if err != nil {
		return nil, err
	}

	err = query.
		Select(
			"COALESCE(SUM(revenue), 0) AS revenue, "+
				"COALESCE(SUM(cogs), 0) AS cogs, "+
				"COALESCE(SUM(shipping_cost), 0) AS shipping_cost, "+
				"COALESCE(SUM(expected_margin), 0) AS expected_margin, "+
				// How much of the total is not to be trusted (#74). Counted, not excluded: dropping
				// these rows would understate revenue that genuinely happened, while including them
				// silently overstates margin. Naming the number is the only honest option.
				"COUNT(*) FILTER (WHERE NOT cost_known) AS unknown_cost_orders",
		).
		Where("team_id = ? AND voided_at IS NULL", msg.GetTeamId()).
		Scan(&agg).
		Error
	if err != nil {
		return nil, revenueErr(err)
	}

	return &revenuev1.RevenueTotals{
		Revenue:           agg.Revenue,
		Cogs:              agg.Cogs,
		ShippingCost:      agg.ShippingCost,
		ExpectedMargin:    agg.ExpectedMargin,
		UnknownCostOrders: uint64(agg.UnknownCostOrders),
	}, nil
}

// The layout a period bound crosses the wire in — a DATE, matching CostList so the profit screen can
// hand the same pair to both services (#171/#172).
const dateLayout = "2006-01-02"

var errBadDate = errors.New("a date must be YYYY-MM-DD")

// withPeriod narrows a query to an INCLUSIVE day range over `created_at`.
//
// ⚠ THE UPPER BOUND IS HALF-OPEN, and that is the whole subtlety of this function.
//
// `created_at` is a TIMESTAMPTZ, not a DATE — unlike cost_records.occurred_at, where an inclusive
// `<= to` is simply correct. Here `created_at <= '2026-07-31'` means `<= 2026-07-31 00:00:00`, so it
// silently drops every order placed after midnight on the last day of the period: almost the whole
// day, every month, for a filter that looks right.
//
// So the caller's inclusive `to` becomes `< to + 1 day`. That is exact, it needs no end-of-day
// arithmetic against timezones, and it still uses an index on created_at — which `created_at::date`
// would not.
func withPeriod(query *gorm.DB, from, to string) (*gorm.DB, error) {
	if from != "" {
		start, err := time.Parse(dateLayout, from)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errBadDate)
		}

		query = query.Where("created_at >= ?", start)
	}

	if to != "" {
		end, err := time.Parse(dateLayout, to)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errBadDate)
		}

		query = query.Where("created_at < ?", end.AddDate(0, 0, 1))
	}

	return query, nil
}
