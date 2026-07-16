package selling_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderConfirm moves a PLACED order to CONFIRMED, scoped to the team. Only a placed order can be
// confirmed — a confirmed or cancelled order is rejected (FailedPrecondition). Selling-side only:
// no inventory is touched.
func (s *Service) OrderConfirm(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderConfirmRequest],
) (*connect.Response[sellingv1.OrderConfirmResponse], error) {
	var order selling_service_models.Order

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := loadScopedOrder(tx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), &order)
		if loadErr != nil {
			return loadErr
		}

		if order.Status != orderStatusPlaced {
			return errNotPlaced
		}

		return setOrderStatus(tx, &order, orderStatusConfirmed)
	})
	if err != nil {
		return nil, mapOrderErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderConfirmResponse{Order: orderToProto(&order)}), nil
}
