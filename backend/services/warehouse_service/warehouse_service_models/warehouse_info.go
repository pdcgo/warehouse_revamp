package warehouse_service_models

import "time"

// WarehouseInfo is a row of `warehouse_infos` (00002) — a warehouse's PROFILE: its two weekly grids, as JSONB, and its
// location (the-warehouse-profile-lives-in-warehouse-service). One per warehouse.
type WarehouseInfo struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64

	OperatingHours string `gorm:"type:jsonb"`
	ReceivingHours string `gorm:"type:jsonb"`

	Location string

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (WarehouseInfo) TableName() string {
	return "warehouse_infos"
}
