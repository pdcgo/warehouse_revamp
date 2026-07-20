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

	return connect.NewResponse(&revenuev1.RevenueListResponse{
		Revenues: out,
		PageInfo: pageInfo(page, total),
	}), nil
}
