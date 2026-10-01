package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// StockReceive records incoming goods: a positive movement into the scoped warehouse.
func (s *Service) StockReceive(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockReceiveRequest],
) (*connect.Response[inventoryv1.StockReceiveResponse], error) {
	mv, err := s.recordSingle(
		ctx,
		req.Msg.GetWarehouseId(),
		req.Msg.GetProductId(),
		req.Msg.GetQuantity(),
		inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE,
		req.Msg.GetReason(),
		req.Msg.GetRef(),
	)
	if err != nil {
		return nil, writeError(err)
	}

	return connect.NewResponse(&inventoryv1.StockReceiveResponse{Movement: movementToProto(mv)}), nil
}
