package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierUpdate edits a supplier in the scoped team. Absent fields are left alone. The team_id
// clause scopes the write — a supplier in another team reads as NotFound.
func (s *Service) SupplierUpdate(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierUpdateRequest],
) (*connect.Response[inventoryv1.SupplierUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()
	supplierID := req.Msg.GetSupplierId()

	updates := map[string]any{}

	if req.Msg.Code != nil {
		updates["code"] = req.Msg.GetCode()
	}

	if req.Msg.Name != nil {
		updates["name"] = req.Msg.GetName()
	}

	if req.Msg.Contact != nil {
		updates["contact"] = req.Msg.GetContact()
	}

	if req.Msg.Province != nil {
		updates["province"] = req.Msg.GetProvince()
	}

	if req.Msg.City != nil {
		updates["city"] = req.Msg.GetCity()
	}

	if req.Msg.Address != nil {
		updates["address"] = req.Msg.GetAddress()
	}

	if req.Msg.Description != nil {
		updates["description"] = req.Msg.GetDescription()
	}

	var supplier inventory_service_models.Supplier

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check existence FIRST — Postgres reports 0 rows affected when an UPDATE writes identical
		// values, so inferring NotFound from RowsAffected would misfire on a no-op resubmit.
		exists, err := supplierExists(tx, teamID, supplierID)
		if err != nil {
			return err
		}

		if !exists {
			return errSupplierMissing
		}

		if len(updates) > 0 {
			err = tx.
				Model(&inventory_service_models.Supplier{}).
				Where("id = ? AND team_id = ?", supplierID, teamID).
				Updates(withUpdatedAt(updates)).
				Error
			if err != nil {
				return err
			}
		}

		return tx.Where("id = ? AND team_id = ?", supplierID, teamID).First(&supplier).Error
	})
	if err != nil {
		if errors.Is(err, errSupplierMissing) {
			return nil, supplierNotFound()
		}

		return nil, supplierDBError(err)
	}

	return connect.NewResponse(&inventoryv1.SupplierUpdateResponse{Supplier: supplierToProto(&supplier)}), nil
}
