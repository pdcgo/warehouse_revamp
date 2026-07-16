package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestCreate records a selling team's restock request (status PENDING). It does NOT touch
// stock — the target warehouse does that when it fulfils (#105).
func (s *Service) RestockRequestCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestCreateRequest],
) (*connect.Response[inventoryv1.RestockRequestCreateResponse], error) {
	rr := inventory_service_models.RestockRequest{
		RequestingTeamID: req.Msg.GetTeamId(),
		WarehouseID:      req.Msg.GetWarehouseId(),
		ProductID:        req.Msg.GetProductId(),
		SKU:              req.Msg.GetSku(),
		Name:             req.Msg.GetName(),
		Quantity:         req.Msg.GetQuantity(),
		ShippingCode:     req.Msg.GetShippingCode(),
		Status:           restockStatusPending,
	}

	err := s.db.WithContext(ctx).Create(&rr).Error
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestCreateResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
