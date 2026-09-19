package shipment_service_models

import "time"

// ShipmentChannel is a row of `shipment_channels` — one courier. The schema is owned by goose
// (db_migrations); GORM only reads and writes rows.
type ShipmentChannel struct {
	ID        uint64 `gorm:"primaryKey"`
	Code      string
	Name      string
	Desc      string `gorm:"column:desc"`
	IsDeleted bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (ShipmentChannel) TableName() string {
	return "shipment_channels"
}
