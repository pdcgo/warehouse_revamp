package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferMarkLost is the SELLING team giving the box up — only while shipped, before B signs
// (cancel-before-processed-lost-only-in-transit). The loss is the team's (the-selling-team-bears-broken-missing-and-lost),
// and no ledger moves: the units already left A's book at create and are in the transfer
// (the-transfer-is-where-goods-in-transit-are). A box that turns up is signed for as arrived.
func (s *Service) WarehouseTransferMarkLost(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferMarkLostRequest],
) (*connect.Response[inventoryv1.WarehouseTransferMarkLostResponse], error) {
	wire, err := s.transition(ctx, req.Msg.GetTransferId(), req.Msg.GetTeamId(), sideOwner, "set lost",
		[]models.TransferStatus{models.TransferShipped}, models.TransferLost, req.Msg.GetDescription(), nil)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferMarkLostResponse{Transfer: wire}), nil
}
