package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferArrive is warehouse B signing for the box: shipped → arrived, or lost → arrived when a box given up
// turns up after all (a-transfer-has-seven-statuses). Nothing is counted yet; the accept is the count.
func (s *Service) WarehouseTransferArrive(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferArriveRequest],
) (*connect.Response[inventoryv1.WarehouseTransferArriveResponse], error) {
	wire, err := s.transition(ctx, req.Msg.GetTransferId(), req.Msg.GetTeamId(), sideReceiver, "signed for",
		[]models.TransferStatus{models.TransferShipped, models.TransferLost}, models.TransferArrived, "", nil)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferArriveResponse{Transfer: wire}), nil
}
