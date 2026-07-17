package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackCreate adds a rack to the scoped warehouse (#129).
func (s *Service) RackCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackCreateRequest],
) (*connect.Response[inventoryv1.RackCreateResponse], error) {
	rack := &inventory_service_models.Rack{
		WarehouseID: req.Msg.GetTeamId(),
		Code:        req.Msg.GetCode(),
		Name:        req.Msg.GetName(),
		Description: req.Msg.GetDescription(),
	}

	err := s.db.WithContext(ctx).Create(rack).Error
	if err != nil {
		return nil, rackDBError(err)
	}

	return connect.NewResponse(&inventoryv1.RackCreateResponse{Rack: rackToProto(rack)}), nil
}
