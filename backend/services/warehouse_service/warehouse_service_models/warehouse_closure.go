package warehouse_service_models

import "time"

// WarehouseClosure is a row of `warehouse_closures` (00002) — one ONE-OFF closure: whole days, both inclusive, in
// Asia/Jakarta, with its reason (a-warehouse-records-its-holidays). It only changes the closed-day warning.
type WarehouseClosure struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	FirstDay    time.Time `gorm:"type:date"`
	LastDay     time.Time `gorm:"type:date"`
	Reason      string
	CreatedAt   time.Time
}

func (WarehouseClosure) TableName() string {
	return "warehouse_closures"
}
