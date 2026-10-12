package supplier_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierUpdate writes the fields the request carries — absent ones are left alone — on a live supplier
// of the scoped team. One UPDATE with the scope in its WHERE, so two people correcting different fields of
// the same supplier at once both land, and neither reads-then-overwrites the other.
func (s *Service) SupplierUpdate(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierUpdateRequest],
) (*connect.Response[supplierv1.SupplierUpdateResponse], error) {
	msg := req.Msg
	teamID := msg.GetTeamId()
	supplierID := msg.GetSupplierId()

	updates := map[string]any{}
	if msg.Name != nil {
		updates["name"] = msg.GetName()
	}
	if msg.Contact != nil {
		updates["contact"] = msg.GetContact()
	}
	if msg.Address != nil {
		updates["address"] = msg.GetAddress()
	}
	if msg.Description != nil {
		updates["description"] = msg.GetDescription()
	}

	var supplier *supplier_service_models.Supplier

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if len(updates) > 0 {
			updates["updated_at"] = gorm.Expr("NOW()")

			res := tx.
				Model(&supplier_service_models.Supplier{}).
				Where("id = ? AND team_id = ? AND deleted_at IS NULL", supplierID, teamID).
				Updates(updates)
			if res.Error != nil {
				return internal(res.Error)
			}

			if res.RowsAffected == 0 {
				return notFound(errSupplierMissing)
			}
		}

		var loadErr error

		supplier, loadErr = ownLiveSupplier(tx, teamID, supplierID)

		return loadErr
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&supplierv1.SupplierUpdateResponse{Supplier: supplierToProto(supplier)}), nil
}
