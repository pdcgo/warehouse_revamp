package warehouse_v1

import (
	"context"
	"time"

	"gorm.io/gorm/clause"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// WarehouseFeeSetIfAbsent writes a rate ONLY where the warehouse has none, and says whether it did. It is the dev
// fixture's (`san seed dev`): a fixture must never replace a rate somebody set — WarehouseFeeSet would, it is an upsert.
//
// Not an RPC. It takes WarehouseFeeSet's message so the contract's constraints are the same ones: the caller validates
// it with protovalidate first (a handler called directly gets no interceptor), and the floor-under-cap rule is checked
// here exactly as WarehouseFeeSet checks it, with the table's CHECKs behind both.
func (s *Service) WarehouseFeeSetIfAbsent(ctx context.Context, msg *warehousev1.WarehouseFeeSetRequest) (bool, error) {
	if floorAboveCap(msg) {
		return false, errFloorAboveCap
	}

	now := time.Now()

	written, err := s.insertUnlessSet(ctx, []warehouse_service_models.WarehouseFee{{
		WarehouseID: msg.GetTeamId(),
		FeePercent:  msg.GetFeePercent(),
		MinFee:      msg.GetMinFee(),
		MaxFee:      msg.MaxFee,
		CreatedAt:   now,
		UpdatedAt:   now,
	}})
	if err != nil {
		return false, err
	}

	return written == 1, nil
}

// insertUnlessSet writes each row only where its warehouse has no rate yet, in ONE statement — INSERT … ON CONFLICT
// (warehouse_id) DO NOTHING — and returns how many it wrote. The table's CHECKs refuse a bad row, and then nothing is
// written at all.
func (s *Service) insertUnlessSet(ctx context.Context, rows []warehouse_service_models.WarehouseFee) (int, error) {
	if len(rows) == 0 {
		return 0, nil
	}

	// RowsAffected counts the rows the INSERT returned, which under DO NOTHING are only the ones it wrote.
	result := s.db.
		WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "warehouse_id"}},
			DoNothing: true,
		}).
		Create(&rows)
	if result.Error != nil {
		return 0, result.Error
	}

	return int(result.RowsAffected), nil
}
