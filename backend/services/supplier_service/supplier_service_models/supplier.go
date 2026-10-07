package supplier_service_models

import "time"

// Supplier is a row of `suppliers` — one vendor a selling team buys stock from. Schema owned by goose
// (db_migrations); GORM only reads and writes rows (no AutoMigrate).
//
// team_id is an OPAQUE cross-service id (a team_service team) — no FK. DeletedAt is a plain column, not
// gorm.DeletedAt: every query states `deleted_at IS NULL` itself, because SupplierByIds must read deleted
// rows and a hidden GORM scope is exactly the thing that query would have to remember to switch off.
type Supplier struct {
	ID          uint64 `gorm:"primaryKey"`
	TeamID      uint64
	Name        string
	Contact     string
	Address     string
	Description string
	DeletedAt   *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (Supplier) TableName() string {
	return "suppliers"
}
