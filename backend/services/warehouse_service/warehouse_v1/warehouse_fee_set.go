package warehouse_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm/clause"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

var errFloorAboveCap = errors.New("the floor (min_fee) cannot be above the cap (max_fee) — equal is a flat fee")

// floorAboveCap is the one rule the contract cannot state: a floor above the cap is refused, equal is a flat fee
// (the-fee-has-a-floor-and-a-cap). The table's CHECK backs it. Shared by WarehouseFeeSet and WarehouseFeeSetIfAbsent.
func floorAboveCap(msg *warehousev1.WarehouseFeeSetRequest) bool {
	return msg.MaxFee != nil && msg.GetMinFee() > msg.GetMaxFee()
}

// WarehouseFeeSet sets — or replaces — the warehouse's fee (one-rate-per-warehouse). ONE statement, an INSERT … ON
// CONFLICT (warehouse_id) DO UPDATE on the unique index, so two managers saving at once leave one row holding the later
// rate. An empty max_fee clears the cap (an-empty-cap-means-no-cap); the proto already refuses a cap of 0.
func (s *Service) WarehouseFeeSet(
	ctx context.Context,
	req *connect.Request[warehousev1.WarehouseFeeSetRequest],
) (*connect.Response[warehousev1.WarehouseFeeSetResponse], error) {
	msg := req.Msg

	if floorAboveCap(msg) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errFloorAboveCap)
	}

	now := time.Now()

	row := warehouse_service_models.WarehouseFee{
		WarehouseID: msg.GetTeamId(),
		FeePercent:  msg.GetFeePercent(),
		MinFee:      msg.GetMinFee(),
		MaxFee:      msg.MaxFee,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	// RETURNING every column, so a replace hands back the row's original id and created_at.
	err := s.db.
		WithContext(ctx).
		Clauses(
			clause.OnConflict{
				Columns: []clause.Column{{Name: "warehouse_id"}},
				DoUpdates: clause.Assignments(map[string]any{
					"fee_percent": row.FeePercent,
					"min_fee":     row.MinFee,
					// nil writes NULL — an emptied cap is cleared, not left as it was.
					"max_fee":    row.MaxFee,
					"updated_at": now,
				}),
			},
			clause.Returning{},
		).
		Create(&row).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&warehousev1.WarehouseFeeSetResponse{Fee: feeToProto(&row)}), nil
}
