package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferProcess is warehouse A confirming the transfer and printing its pick list: created → process. From
// here on the team can no longer cancel (cancel-before-processed-lost-only-in-transit).
func (s *Service) WarehouseTransferProcess(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferProcessRequest],
) (*connect.Response[inventoryv1.WarehouseTransferProcessResponse], error) {
	wire, err := s.transition(ctx, req.Msg.GetTransferId(), req.Msg.GetTeamId(), sideSender, "processed",
		[]models.TransferStatus{models.TransferCreated}, models.TransferProcess, "", nil)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferProcessResponse{Transfer: wire}), nil
}
