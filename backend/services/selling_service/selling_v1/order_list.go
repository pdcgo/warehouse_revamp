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

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Order{}).
		Where("team_id = ?", req.Msg.GetTeamId())

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
