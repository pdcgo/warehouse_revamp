package revenue_v1

import (
	"context"

	"connectrpc.com/connect"

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
		Where("team_id = ?", req.Msg.GetTeamId())

	var total int64

	err := query.Count(&total).Error
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
	totals, err := teamTotals(ctx, s, req.Msg.GetTeamId())
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

func teamTotals(ctx context.Context, s *Service, teamID uint64) (*revenuev1.RevenueTotals, error) {
	var agg totalsRow

	err := s.db.
		WithContext(ctx).
		Model(&revenue_service_models.OrderRevenue{}).
		Select(
			"COALESCE(SUM(revenue), 0) AS revenue, " +
				"COALESCE(SUM(cogs), 0) AS cogs, " +
				"COALESCE(SUM(shipping_cost), 0) AS shipping_cost, " +
				"COALESCE(SUM(expected_margin), 0) AS expected_margin, " +
				// How much of the total is not to be trusted (#74). Counted, not excluded: dropping
				// these rows would understate revenue that genuinely happened, while including them
				// silently overstates margin. Naming the number is the only honest option.
				"COUNT(*) FILTER (WHERE NOT cost_known) AS unknown_cost_orders",
		).
		Where("team_id = ?", teamID).
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
