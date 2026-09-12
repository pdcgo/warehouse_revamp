package shipping_service_models

import "time"

// Shipping is a row of `shippings` — one courier. Reference data seeded by migration; the schema is
// owned by goose (db_migrations), GORM only reads and writes rows (no AutoMigrate).
type Shipping struct {
	ID        uint64 `gorm:"primaryKey"`
	Code      string
	Name      string
	Active    bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Shipping) TableName() string {
	return "shippings"
}
