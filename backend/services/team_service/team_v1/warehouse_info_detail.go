package team_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// WarehouseInfoDetail implements [teamv1connect.TeamServiceHandler]. Any authenticated caller —
// a selling team needs to know when a warehouse can receive its orders.
//
// A warehouse that has never had its hours set has NO warehouse_infos row; that is not an error,
// it just means "every day closed" — the response carries empty schedules.
func (s *Service) WarehouseInfoDetail(
	ctx context.Context,
	req *connect.Request[teamv1.WarehouseInfoDetailRequest],
) (*connect.Response[teamv1.WarehouseInfoDetailResponse], error) {
	teamID := req.Msg.GetTeamId()

	isWarehouse, err := warehouseTeamExists(s.db.WithContext(ctx), teamID)
	if err != nil {
		return nil, dbError(err)
	}

	if !isWarehouse {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("warehouse not found"))
	}

	var info team_service_models.WarehouseInfo

	err = s.db.
		WithContext(ctx).
		Where("team_id = ?", teamID).
		First(&info).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// No hours set yet — empty schedules, not an error.
			return connect.NewResponse(&teamv1.WarehouseInfoDetailResponse{
				Info: &teamv1.WarehouseInfo{TeamId: teamID},
			}), nil
		}

		return nil, dbError(err)
	}

	out, err := warehouseInfoToProto(&info)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&teamv1.WarehouseInfoDetailResponse{Info: out}), nil
}
