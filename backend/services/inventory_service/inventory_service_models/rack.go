package inventory_service_models

import (
	"strings"
	"time"
)

// Rack is a row of `placements` — one physical place inside a warehouse (#129). The screen says Racks, the schema says
// placements (the-racks-page-is-the-placement-list). Schema owned by goose (db_migrations, 00028); GORM only reads and
// writes rows (no AutoMigrate).
//
// warehouse_id is an OPAQUE cross-service id (a team_service team of type WAREHOUSE) — no FK; scope is enforced by the
// access interceptor (use_scope), not the DB. The product_placements rows on it are what it holds.
type Rack struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	// What is painted on the shelf, saved trimmed and lowercase ('a-01-3') — rack-codes-are-saved-lowercase. Unique
	// per warehouse among the racks in use.
	Code        string
	Name        string
	Description string
	// Soft delete, allowed only at zero stock (a-placement-deletes-at-zero-stock). nil = in use.
	DeletedAt *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Rack) TableName() string {
	return "placements"
}

// CleanRackCode is a code as it is saved and compared: the ends trimmed, lowercase — the inner characters untouched,
// because the painted label is the label (rack-codes-are-saved-lowercase).
func CleanRackCode(code string) string {
	return strings.ToLower(strings.TrimSpace(code))
}
