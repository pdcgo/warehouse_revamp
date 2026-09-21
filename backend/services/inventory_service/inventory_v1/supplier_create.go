package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierCreate adds a supplier to the scoped team.
func (s *Service) SupplierCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierCreateRequest],
) (*connect.Response[inventoryv1.SupplierCreateResponse], error) {
	supplier := &inventory_service_models.Supplier{
		TeamID:      req.Msg.GetTeamId(),
		Code:        req.Msg.GetCode(),
		Name:        req.Msg.GetName(),
		Contact:     req.Msg.GetContact(),
		Province:    req.Msg.GetProvince(),
		City:        req.Msg.GetCity(),
		Address:     req.Msg.GetAddress(),
		Description: req.Msg.GetDescription(),
	}

	err := s.db.WithContext(ctx).Create(supplier).Error
	if err != nil {
		return nil, supplierDBError(err)
	}

	return connect.NewResponse(&inventoryv1.SupplierCreateResponse{Supplier: supplierToProto(supplier)}), nil
}
