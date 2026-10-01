package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierDelete soft-deletes a supplier in the scoped team (`deleted = true`), which also frees its
// code for reuse. A supplier in another team reads as NotFound.
func (s *Service) SupplierDelete(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierDeleteRequest],
) (*connect.Response[inventoryv1.SupplierDeleteResponse], error) {
	teamID := req.Msg.GetTeamId()
	supplierID := req.Msg.GetSupplierId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := supplierExists(tx, teamID, supplierID)
		if err != nil {
			return err
		}

		if !exists {
			return errSupplierMissing
		}

		return tx.
			Model(&inventory_service_models.Supplier{}).
			Where("id = ? AND team_id = ?", supplierID, teamID).
			Updates(withUpdatedAt(map[string]any{"deleted": true})).
			Error
	})
	if err != nil {
		if errors.Is(err, errSupplierMissing) {
			return nil, supplierNotFound()
		}

		return nil, supplierDBError(err)
	}

	return connect.NewResponse(&inventoryv1.SupplierDeleteResponse{}), nil
}
