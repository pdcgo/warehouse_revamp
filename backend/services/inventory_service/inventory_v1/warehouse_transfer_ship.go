package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferShip is warehouse A handing the box over: process → shipped, with the courier, the tracking number and
// the label photo (the-sender-enters-the-courier-at-ship) — all optional, since a warehouse's own vehicle has none of
// them (a-transfer-may-travel-without-a-courier).
func (s *Service) WarehouseTransferShip(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferShipRequest],
) (*connect.Response[inventoryv1.WarehouseTransferShipResponse], error) {
	trip := map[string]any{
		"shipment_id":  req.Msg.GetShipmentId(),
		"receipt":      req.Msg.GetReceipt(),
		"receipt_file": req.Msg.GetReceiptFile(),
	}

	wire, err := s.transition(ctx, req.Msg.GetTransferId(), req.Msg.GetTeamId(), sideSender, "shipped",
		[]models.TransferStatus{models.TransferProcess}, models.TransferShipped, "", trip)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferShipResponse{Transfer: wire}), nil
}
