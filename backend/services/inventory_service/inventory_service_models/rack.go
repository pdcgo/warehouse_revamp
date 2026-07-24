package inventory_service_models

import "time"

// Rack is a row of `racks` — one physical place inside a warehouse (#129). Schema owned by goose
// (db_migrations); GORM only reads and writes rows (no AutoMigrate).
//
// warehouse_id is an OPAQUE cross-service id (a team_service team of type WAREHOUSE) — no FK; scope
// is enforced by the access interceptor (use_scope), not the DB.
//
// This is the registry, not a location model: nothing points at a rack yet, and stock is still
// counted per (warehouse, product). Stock ON a rack is plans/inventory_service/ §3's open decision.
type Rack struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	// What is painted on the shelf ('A-01-3'). Unique per warehouse among active racks.
	Code        string
	Name        string
	Description string
	Deleted     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (Rack) TableName() string {
	return "racks"
}
