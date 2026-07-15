package team_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

var errNotWarehouse = errors.New("team is not a warehouse")

// WarehouseInfoUpdate implements [teamv1connect.TeamServiceHandler]. Scoped: a warehouse manager
// edits their own warehouse's hours (the interceptor already proved the role in team_id).
//
// It fully REPLACES both schedules — the editor sends the whole weekly grid — via an upsert on
// team_id, the same duplicate-row-proof pattern as TeamInfoUpdate.
func (s *Service) WarehouseInfoUpdate(
	ctx context.Context,
	req *connect.Request[teamv1.WarehouseInfoUpdateRequest],
) (*connect.Response[teamv1.WarehouseInfoUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()

	operating, err := validateSchedule(req.Msg.GetOperatingHours())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	receiving, err := validateSchedule(req.Msg.GetReceivingHours())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	operatingJSON, err := encodeSchedule(operating)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	receivingJSON, err := encodeSchedule(receiving)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var info team_service_models.WarehouseInfo

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		isWarehouse, err := warehouseTeamExists(tx, teamID)
		if err != nil {
			return err
		}

		if !isWarehouse {
			return errNotWarehouse
		}

		row := team_service_models.WarehouseInfo{
			TeamID:         teamID,
			OperatingHours: operatingJSON,
			ReceivingHours: receivingJSON,
		}

		err = tx.
			Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "team_id"}},
				DoUpdates: clause.Assignments(map[string]any{
					"operating_hours": operatingJSON,
					"receiving_hours": receivingJSON,
					"updated_at":      gorm.Expr("NOW()"),
				}),
			}).
			Create(&row).
			Error
		if err != nil {
			return err
		}

		return tx.Where("team_id = ?", teamID).First(&info).Error
	})
	if err != nil {
		if errors.Is(err, errNotWarehouse) {
			return nil, connect.NewError(connect.CodeInvalidArgument, errNotWarehouse)
		}

		return nil, dbError(err)
	}

	out, err := warehouseInfoToProto(&info)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&teamv1.WarehouseInfoUpdateResponse{Info: out}), nil
}

// warehouseTeamExists reports whether teamID is a live team of type warehouse.
func warehouseTeamExists(tx *gorm.DB, teamID uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&team_service_models.Team{}).
		Where("id = ? AND deleted = ? AND type = ?", teamID, false, "warehouse").
		Count(&count).
		Error
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

// warehouseInfoToProto builds the proto from a stored row, decoding both JSONB schedules.
func warehouseInfoToProto(info *team_service_models.WarehouseInfo) (*teamv1.WarehouseInfo, error) {
	operating, err := decodeSchedule(info.OperatingHours)
	if err != nil {
		return nil, err
	}

	receiving, err := decodeSchedule(info.ReceivingHours)
	if err != nil {
		return nil, err
	}

	return &teamv1.WarehouseInfo{
		TeamId:         info.TeamID,
		OperatingHours: operating,
		ReceivingHours: receiving,
	}, nil
}
