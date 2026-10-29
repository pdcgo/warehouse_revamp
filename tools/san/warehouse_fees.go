package main

import (
	"context"
	"database/sql"

	"buf.build/go/protovalidate"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// NewWarehouseFees is warehouse_service as the operations tool needs it: the fee table's own writes and nothing else. No
// namer — it names a warehouse only to refuse a fee calculation, and no command calculates one.
func NewWarehouseFees(db *gorm.DB) *warehouse_v1.Service {
	return warehouse_v1.NewService(db, nil)
}

// devWarehouseFee is the dev fixture's rate for Dev Warehouse: the decisions' worked example
// (the-fee-has-a-floor-and-a-cap) — 2.5%, a floor of 2.000, a cap of 20.000.
func devWarehouseFee(warehouseID uint64) *warehousev1.WarehouseFeeSetRequest {
	return &warehousev1.WarehouseFeeSetRequest{
		TeamId:     warehouseID,
		FeePercent: 2.5,
		MinFee:     2_000,
		MaxFee:     proto.Float64(20_000),
	}
}

// seedDevWarehouseFee gives Dev Warehouse a rate, so dev can place orders — a warehouse with none is refused
// (a-warehouse-with-no-rate-takes-no-orders). It returns the line to print. A rate already set is left alone, whoever
// set it; only a warehouse with none gets the worked example.
//
// ⛔ It no longer carries Dev Warehouse's flat fee over first: that fee was dropped at step 5 of
// the-flat-rate-is-dropped-last, and with it `san warehouse carry-over-fees` (step 2), whose one job was moving the flat
// fees into warehouse_service before the column went.
func seedDevWarehouseFee(ctx context.Context, db *gorm.DB, warehouseID uint64) (string, error) {
	svc := NewWarehouseFees(db)
	req := devWarehouseFee(warehouseID)

	// A handler called directly gets no validation interceptor, so the contract is checked here (HARD RULE 3b).
	err := protovalidate.Validate(req)
	if err != nil {
		return "", err
	}

	written, err := svc.WarehouseFeeSetIfAbsent(ctx, req)
	if err != nil {
		return "", err
	}

	if !written {
		return "Dev Warehouse already has a fee — left as it is", nil
	}

	return "Dev Warehouse fee: 2.5%, floor 2000, cap 20000", nil
}

// gormOn wraps an open connection for the services' code, which is written against GORM.
func gormOn(db *sql.DB) (*gorm.DB, error) {
	return gorm.Open(postgres.New(postgres.Config{Conn: db}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
}
