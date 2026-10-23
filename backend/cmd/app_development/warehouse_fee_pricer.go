package main

import (
	"context"

	"connectrpc.com/connect"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// warehouseFeePricer joins selling_service to warehouse_service (warehouse-prices-balance-records): order create asks
// the fulfilling warehouse's price for the order's goods and freezes the answer (the-flat-rate-is-dropped-last step 3).
//
// Same shape as creditChecker beside it — selling declares the interface in its own terms, and this adapter is the
// whole dependency between the two. It calls WarehouseFeeCalculate itself, the RPC the decision names
// (the-fee-is-priced-one-warehouse-at-a-time), in-process: the same handler the order form calls over the wire, so the
// form's preview and the frozen fee are one computation.
//
// ⚠ The refusal is passed back AS IT CAME — a FailedPrecondition naming the warehouse that has not set its fee
// (a-warehouse-with-no-rate-takes-no-orders) — which is what WarehouseFeePricer promises selling.
type warehouseFeePricer struct {
	warehouse *warehouse_v1.Service
}

func NewWarehouseFeePricer(warehouse *warehouse_v1.Service) selling_v1.WarehouseFeePricer {
	return &warehouseFeePricer{warehouse: warehouse}
}

func (p *warehouseFeePricer) Price(ctx context.Context, teamID, warehouseID uint64, goodsCost float64) (float64, error) {
	resp, err := p.warehouse.WarehouseFeeCalculate(ctx, connect.NewRequest(&warehousev1.WarehouseFeeCalculateRequest{
		TeamId:      teamID,
		OrderTotal:  goodsCost,
		WarehouseId: warehouseID,
	}))
	if err != nil {
		return 0, err
	}

	return resp.Msg.GetCalculatedWarehouseFee(), nil
}
