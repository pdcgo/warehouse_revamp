package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackUpdate edits a rack in the scoped warehouse (#129). Absent fields are left alone. The
// warehouse_id clause is the scope — another warehouse's rack reads as NotFound.
func (s *Service) RackUpdate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackUpdateRequest],
) (*connect.Response[inventoryv1.RackUpdateResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	rackID := req.Msg.GetRackId()

	updates := map[string]any{}

	if req.Msg.Code != nil {
		updates["code"] = req.Msg.GetCode()
	}

	if req.Msg.Name != nil {
		updates["name"] = req.Msg.GetName()
	}

	if req.Msg.Description != nil {
		updates["description"] = req.Msg.GetDescription()
	}

	var rack inventory_service_models.Rack

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check existence FIRST — Postgres reports 0 rows affected when an UPDATE writes identical
		// values, so inferring NotFound from RowsAffected would misfire on a no-op resubmit.
		exists, existsErr := rackExists(tx, warehouseID, rackID)
		if existsErr != nil {
			return existsErr
		}

		if !exists {
			return errRackMissing
		}

		if len(updates) > 0 {
			updateErr := tx.
				Model(&inventory_service_models.Rack{}).
				Where("id = ? AND warehouse_id = ?", rackID, warehouseID).
				Updates(withUpdatedAt(updates)).
				Error
			if updateErr != nil {
				return updateErr
			}
		}

		return tx.Where("id = ? AND warehouse_id = ?", rackID, warehouseID).First(&rack).Error
	})
	if err != nil {
		if errors.Is(err, errRackMissing) {
			return nil, rackNotFound()
		}

		return nil, rackDBError(err)
	}

	return connect.NewResponse(&inventoryv1.RackUpdateResponse{Rack: rackToProto(&rack)}), nil
}
