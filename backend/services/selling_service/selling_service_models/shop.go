package selling_service_models

import "time"

// Shop is a row of `shops` — one marketplace storefront owned by a SELLING team. Schema owned by
// goose (db_migrations); GORM only reads and writes rows (no AutoMigrate).
type Shop struct {
	ID       uint64 `gorm:"primaryKey"`
	TeamID   uint64
	Name     string
	ShopCode string `gorm:"column:shop_code"`

	// The marketplace enum stored as TEXT ("shopee", …) — mapped to/from the proto enum in
	// selling_v1/mapper.go. No DB CHECK on the value: the mapper + proto validation are the guard,
	// and a CHECK IN-list is just another place to forget when the enum grows (cf. #80).
	Marketplace string

	Description string
	Deleted     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (Shop) TableName() string {
	return "shops"
}
