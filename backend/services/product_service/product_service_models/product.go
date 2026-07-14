package product_service_models

import "time"

// Product is a row of `products` — one catalogue item, owned by a team. Schema owned by goose
// (db_migrations); GORM only reads and writes rows (no AutoMigrate).
type Product struct {
	ID          uint64 `gorm:"primaryKey"`
	TeamID      uint64
	SKU         string `gorm:"column:sku"`
	Name        string
	Description string
	Deleted     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (Product) TableName() string {
	return "products"
}
