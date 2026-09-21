package selling_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderConfirm — THE WAREHOUSE ACCEPTS THE JOB. PLACED → CONFIRMED, and the first of the four steps
// the crew works (owner). Only a placed order can be confirmed; anything else is FailedPrecondition.
//
// ⚠ SCOPED TO THE ORDER'S WAREHOUSE, not its selling team. This reverses #91, where the selling team
// confirmed its own order through loadScopedOrder — a scope that cannot work for the crew, who hold no
// role in the team that placed it. loadWarehouseOrder is the same load the other three steps use, so
// all four now ask one question: do you work in the building this order ships from?
//
// No inventory is touched. Stock was already committed when the order was placed (#149) — confirming
// records that the building has seen the order and taken it on, nothing more.
func (s *Service) OrderConfirm(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderConfirmRequest],
) (*connect.Response[sellingv1.OrderConfirmResponse], error) {
	var order selling_service_models.Order

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := loadWarehouseOrder(tx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), &order)
		if loadErr != nil {
			return loadErr
		}

		// Kept as its own check rather than folded into `advance`, which would report the generic
		// errWrongStateForStep. "Only a placed order can be confirmed" is the message that tells a
		// caller what actually happened — usually that somebody else confirmed it a second earlier.
		if order.Status != orderStatusPlaced {
			return errNotPlaced
		}

		return setOrderStatus(tx, &order, orderStatusConfirmed, eventActor(ctx))
	})
	if err != nil {
		return nil, mapOrderErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderConfirmResponse{Order: orderToProto(&order)}), nil
}
