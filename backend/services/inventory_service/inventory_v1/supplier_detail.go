package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierDetail returns one active supplier in the scoped team. The team_id clause is the scope
// check — another team's supplier reads as NotFound.
func (s *Service) SupplierDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierDetailRequest],
) (*connect.Response[inventoryv1.SupplierDetailResponse], error) {
	var supplier inventory_service_models.Supplier

	err := s.db.
		WithContext(ctx).
		Where("id = ? AND team_id = ? AND deleted = ?", req.Msg.GetSupplierId(), req.Msg.GetTeamId(), false).
		First(&supplier).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, supplierNotFound()
		}

		return nil, supplierDBError(err)
	}

	return connect.NewResponse(&inventoryv1.SupplierDetailResponse{Supplier: supplierToProto(&supplier)}), nil
}
