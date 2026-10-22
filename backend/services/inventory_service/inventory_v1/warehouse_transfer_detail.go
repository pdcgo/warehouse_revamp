package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferDetail is one transfer in full — lines, pick list, put-away, problems and trail — for any side: the
// owning team, A or B. A transfer the team is no side of reads as NotFound.
func (s *Service) WarehouseTransferDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferDetailRequest],
) (*connect.Response[inventoryv1.WarehouseTransferDetailResponse], error) {
	teamID := req.Msg.GetTeamId()
	db := s.db.WithContext(ctx)

	var count int64

	err := db.
		Model(&models.WarehouseTransfer{}).
		Where("id = ? AND (team_id = ? OR from_warehouse_id = ? OR to_warehouse_id = ?)",
			req.Msg.GetTransferId(), teamID, teamID, teamID).
		Count(&count).Error
	if err != nil {
		return nil, transferErr(err)
	}

	if count == 0 {
		return nil, transferErr(errTransferMissing)
	}

	wire, err := transferForWire(db, req.Msg.GetTransferId())
	if err != nil {
		return nil, transferErr(err)
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferDetailResponse{Transfer: wire}), nil
}
