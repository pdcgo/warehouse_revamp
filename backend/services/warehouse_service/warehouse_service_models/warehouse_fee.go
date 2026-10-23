package warehouse_service_models

import "time"

// WarehouseFee is a row of `warehouse_fees` — one warehouse's fee configuration (one-rate-per-warehouse). No row = the
// warehouse never set its fee (a-warehouse-with-no-rate-takes-no-orders). Schema owned by goose (db_migrations).
type WarehouseFee struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64

	// 2.5 = 2.5%.
	FeePercent float64
	// The floor; 0 = no floor.
	MinFee float64
	// The cap; nil = no cap (an-empty-cap-means-no-cap).
	MaxFee *float64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (WarehouseFee) TableName() string {
	return "warehouse_fees"
}
