package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackDelete SOFT-deletes a rack in the scoped warehouse (#129) — the row stays, `deleted` flips.
//
// Soft, because a rack is a physical thing that gets re-labelled or taken out of service, not a
// mistake to erase; and the partial unique index frees its code for reuse the moment it is deleted.
func (s *Service) RackDelete(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackDeleteRequest],
) (*connect.Response[inventoryv1.RackDeleteResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	rackID := req.Msg.GetRackId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, existsErr := rackExists(tx, warehouseID, rackID)
		if existsErr != nil {
			return existsErr
		}

		if !exists {
			return errRackMissing
		}

		return tx.
			Model(&inventory_service_models.Rack{}).
			Where("id = ? AND warehouse_id = ?", rackID, warehouseID).
			Updates(withUpdatedAt(map[string]any{"deleted": true})).
			Error
	})
	if err != nil {
		if errors.Is(err, errRackMissing) {
			return nil, rackNotFound()
		}

		return nil, rackDBError(err)
	}

	return connect.NewResponse(&inventoryv1.RackDeleteResponse{}), nil
}
