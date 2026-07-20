package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderList returns the scoped team's orders, newest first, paginated. Summaries only — the lines
// come from OrderDetail.
func (s *Service) OrderList(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderListRequest],
) (*connect.Response[sellingv1.OrderListResponse], error) {
	page := req.Msg.GetPage()

	teamID := req.Msg.GetTeamId()

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Order{}).
		// BOTH SIDES (#151): the team that placed the order, or the warehouse shipping it. The latter is
		// the pick queue.
		//
		// The parentheses are written explicitly even though GORM does not need them here — it wraps a
		// chained Where containing an OR before AND-ing the next one, so the generated SQL is already
		// `(team_id = ? OR warehouse_id = ?) AND status = ?`. (Verified against the emitted SQL, not
		// assumed.) They stay because the correctness of the status filter below should be readable
		// from THIS line rather than resting on an ORM behaviour: precedence is what makes an OR-plus-
		// filter go wrong, and hand-built SQL a refactor away would not be so forgiving.
		Where("(team_id = ? OR warehouse_id = ?)", teamID, teamID)

	// One status, or all of them. Server-side because the list is PAGINATED: a client-side filter would
	// narrow the loaded page only, and the count would still be the unfiltered total.
	if status := orderStatusToText(req.Msg.GetStatus()); status != "" {
		query = query.Where("status = ?", status)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var orders []selling_service_models.Order

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&orders).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*sellingv1.Order, 0, len(orders))
	for i := range orders {
		out = append(out, orderToProto(&orders[i]))
	}

	return connect.NewResponse(&sellingv1.OrderListResponse{
		Orders: out,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
