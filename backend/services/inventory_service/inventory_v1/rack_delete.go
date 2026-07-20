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
//
// A rack that still HOLDS STOCK is refused (#138, owner's call): empty the shelf first.
//
// The check has to live here because the FK cannot do it. `stock_levels.rack_id` is ON DELETE
// RESTRICT, but this is a SOFT delete — the row is never removed, so the constraint never fires. Left
// unguarded, the goods would be STRANDED: still in stock_levels, at a location that had vanished from
// every list, where nobody could find them or fix them. Moving them to unplaced instead was considered
// and rejected — the boxes are still physically on that shelf until a person moves them, so recording
// them as "somewhere" would be inventing a location nobody observed.
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

		// Anything left on the shelf, inside the same transaction as the flip, so a receipt landing
		// concurrently cannot slip between the check and the delete.
		var onShelf int64

		countErr := tx.Raw(
			`SELECT COALESCE(SUM(on_hand), 0) FROM stock_levels WHERE rack_id = ?`,
			rackID,
		).Scan(&onShelf).Error
		if countErr != nil {
			return countErr
		}

		if onShelf > 0 {
			return errRackHoldsStock
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

		if errors.Is(err, errRackHoldsStock) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errRackHoldsStock)
		}

		return nil, rackDBError(err)
	}

	return connect.NewResponse(&inventoryv1.RackDeleteResponse{}), nil
}
