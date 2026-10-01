package inventory_service_models

import "time"

// Supplier is a row of `suppliers` — one vendor a team buys stock from. Schema owned by goose
// (db_migrations); GORM only reads and writes rows (no AutoMigrate).
//
// team_id is an OPAQUE cross-service id (a team_service team) — no FK; scope is enforced by the
// access interceptor (use_scope), not the DB.
type Supplier struct {
	ID          uint64 `gorm:"primaryKey"`
	TeamID      uint64
	Code        string
	Name        string
	Contact     string
	Province    string
	City        string
	Address     string
	Description string
	Deleted     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (Supplier) TableName() string {
	return "suppliers"
}
