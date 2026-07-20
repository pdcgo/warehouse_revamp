package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackDetail returns one rack of the scoped warehouse (#138) — the header of its detail page.
//
// The scope IS the WHERE clause: a rack belonging to another warehouse reads as NotFound, never
// PermissionDenied, or the error itself would confirm the id exists.
func (s *Service) RackDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackDetailRequest],
) (*connect.Response[inventoryv1.RackDetailResponse], error) {
	var rack inventory_service_models.Rack

	err := s.db.
		WithContext(ctx).
		Where("id = ? AND warehouse_id = ? AND deleted = ?", req.Msg.GetRackId(), req.Msg.GetTeamId(), false).
		First(&rack).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, rackNotFound()
		}

		return nil, rackDBError(err)
	}

	return connect.NewResponse(&inventoryv1.RackDetailResponse{
		Rack: rackToProto(&rack),
	}), nil
}
