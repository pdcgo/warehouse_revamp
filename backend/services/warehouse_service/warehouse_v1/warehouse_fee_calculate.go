package warehouse_v1

import (
	"context"
	"fmt"
	"strconv"

	"connectrpc.com/connect"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// WarehouseFeeCalculate prices one order at one warehouse (the-fee-is-priced-one-warehouse-at-a-time): the fee, and the
// rate it used so the charge can be explained later. The ordering team is the scope only — the rate never depends on
// it (one-rate-per-warehouse).
//
// A warehouse that never set its fee gets FailedPrecondition naming it, never a number
// (a-warehouse-with-no-rate-takes-no-orders): nothing is charged silently.
func (s *Service) WarehouseFeeCalculate(
	ctx context.Context,
	req *connect.Request[warehousev1.WarehouseFeeCalculateRequest],
) (*connect.Response[warehousev1.WarehouseFeeCalculateResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()

	var rows []warehouse_service_models.WarehouseFee

	err := s.db.
		WithContext(ctx).
		Where("warehouse_id = ?", warehouseID).
		Limit(1).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	if len(rows) == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("%s has not set its fee", s.warehouseName(ctx, warehouseID)))
	}

	row := &rows[0]
	goodsCost := req.Msg.GetOrderTotal()

	return connect.NewResponse(&warehousev1.WarehouseFeeCalculateResponse{
		WarehouseId:            warehouseID,
		OrderTotal:             goodsCost,
		FeePercent:             row.FeePercent,
		MinFee:                 row.MinFee,
		MaxFee:                 row.MaxFee,
		CalculatedWarehouseFee: fee(row, goodsCost),
	}), nil
}

// warehouseName is the warehouse's name for a refusal, or "warehouse <id>" when it cannot be had — the refusal must not
// fail for want of a label.
func (s *Service) warehouseName(ctx context.Context, warehouseID uint64) string {
	fallback := "warehouse " + strconv.FormatUint(warehouseID, 10)

	if s.names == nil {
		return fallback
	}

	name, err := s.names.WarehouseName(ctx, warehouseID)
	if err != nil || name == "" {
		return fallback
	}

	return name
}
