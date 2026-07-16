package selling_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderCancel moves a PLACED or CONFIRMED order to CANCELLED (terminal), scoped to the team.
// Cancelling an already cancelled order is rejected (FailedPrecondition). Selling-side only: no
// stock or money is reversed yet — that is #70, once stock integration (#69) lands.
func (s *Service) OrderCancel(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderCancelRequest],
) (*connect.Response[sellingv1.OrderCancelResponse], error) {
	var order selling_service_models.Order

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := loadScopedOrder(tx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), &order)
		if loadErr != nil {
			return loadErr
		}

		if order.Status == orderStatusCancelled {
			return errAlreadyCancelled
		}

		return setOrderStatus(tx, &order, orderStatusCancelled)
	})
	if err != nil {
		return nil, mapOrderErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderCancelResponse{Order: orderToProto(&order)}), nil
}
