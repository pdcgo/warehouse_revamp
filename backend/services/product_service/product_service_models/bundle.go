package product_service_models

import "time"

// Bundle is a row of `bundles` — a selling team's picking recipe: which products, and how many of each go into ONE
// bundle (docs/business/product/product_bundle.md). No stock, no price. Schema owned by goose (db_migrations).
type Bundle struct {
	ID          uint64 `gorm:"primaryKey"`
	TeamID      uint64
	Name        string
	Description string

	// Who made it — the one CS who may change it besides an Admin (the-creator-or-an-admin-edits-a-bundle).
	CreatedByUserID uint64 `gorm:"column:created_by_user_id"`

	// The lines, in the order they were saved (by id). Loaded on demand.
	Lines []BundleProduct `gorm:"foreignKey:BundleID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Bundle) TableName() string {
	return "bundles"
}
