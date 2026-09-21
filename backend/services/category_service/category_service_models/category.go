package category_service_models

import "time"

// Category is a row of `categories` — one node in the GLOBAL product-category taxonomy. Schema owned
// by goose (db_migrations); GORM only reads and writes rows (no AutoMigrate).
//
// ParentID is a nullable pointer: nil means a top-level category. On the wire, top-level is carried
// as parent_id = 0, so the handlers map 0 ⇄ NULL.
type Category struct {
	ID        uint64 `gorm:"primaryKey"`
	Name      string
	ParentID  *uint64
	Deleted   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Category) TableName() string {
	return "categories"
}
