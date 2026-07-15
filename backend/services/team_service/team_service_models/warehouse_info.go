package team_service_models

import "time"

// WarehouseInfo is a warehouse team's operational data, 1:1 with the team. Schema owned by
// goose; GORM only reads/writes rows.
//
// The two schedules are stored as JSONB (a JSON array of day rows). They are held as strings
// here — the pgx driver sends a string to a jsonb column as text, which jsonb parses, and reads
// it back as the stored JSON text. The handler marshals/validates the structure; the model just
// carries the bytes.
type WarehouseInfo struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64

	OperatingHours string `gorm:"type:jsonb"`
	ReceivingHours string `gorm:"type:jsonb"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (WarehouseInfo) TableName() string {
	return "warehouse_infos"
}
