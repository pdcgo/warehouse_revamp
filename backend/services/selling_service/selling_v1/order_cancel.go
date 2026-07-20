package selling_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderCancel moves a PLACED or CONFIRMED order to CANCELLED (terminal), scoped to the team, and PUTS
// ITS STOCK BACK (#70). Cancelling an already cancelled order is rejected (FailedPrecondition).
//
// The stock goes back exactly where it came from — same shelves, same split — because the inventory
// side reverses the movements it recorded rather than trusting quantities from here. That matters for
// a draw the drain order spread across three shelves: a quantity-based return could put it all in one
// place and still balance, which would be a lie about where the goods are.
//
// ORDER OF OPERATIONS, and it is the mirror of OrderCreate's: the status flips FIRST, inside the
// transaction, and the stock returns before it commits. So a return that fails means the cancel rolls
// back and the order stays live — better than an order marked cancelled whose goods are still held
// out, which nothing would ever reconcile.
//
// An order placed before #149 has no stock draw to undo. The return reports NotFound for a ref that
// never picked anything, and that is treated as success here: those orders never took stock, so there
// is nothing to give back and refusing to cancel them would be punishing history.
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

		statusErr := setOrderStatus(tx, &order, orderStatusCancelled)
		if statusErr != nil {
			return statusErr
		}

		// Give the stock back before this commits (#70). An order with no warehouse predates #72 and
		// never drew any, so there is nothing to return.
		if order.WarehouseID == 0 {
			return nil
		}

		returnErr := s.stock.Return(ctx, order.TeamID, order.WarehouseID, stockRef(order.ID))
		if returnErr != nil && !isNothingToReturn(returnErr) {
			return returnErr
		}

		return nil
	})
	if err != nil {
		return nil, mapOrderErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderCancelResponse{Order: orderToProto(&order)}), nil
}
