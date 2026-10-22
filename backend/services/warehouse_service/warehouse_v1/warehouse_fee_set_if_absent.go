package warehouse_v1

import (
	"context"
	"time"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// WarehouseFeeSetIfAbsent writes a rate ONLY where the warehouse has none, and says whether it did. It is the dev
// fixture's (`san seed dev`): a fixture must never replace a rate somebody set, nor one the carry-over brought over
// (the-flat-rate-is-dropped-last, step 2) — WarehouseFeeSet would, it is an upsert.
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
