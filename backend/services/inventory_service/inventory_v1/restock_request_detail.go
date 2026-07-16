package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestDetail returns ONE request in full, with its lines (#125).
//
// Scoped exactly like List, and the scope IS the WHERE clause: a team may read a request it MADE
// (requesting_team_id) or one TARGETING it as a warehouse (warehouse_id). Anything else reads as
// NotFound rather than PermissionDenied — a permission error would confirm the id exists.
func (s *Service) RestockRequestDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestDetailRequest],
) (*connect.Response[inventoryv1.RestockRequestDetailResponse], error) {
	teamID := req.Msg.GetTeamId()

	var rr inventory_service_models.RestockRequest

	err := s.db.
		WithContext(ctx).
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Where("id = ? AND (requesting_team_id = ? OR warehouse_id = ?)", req.Msg.GetRequestId(), teamID, teamID).
		First(&rr).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestDetailResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
