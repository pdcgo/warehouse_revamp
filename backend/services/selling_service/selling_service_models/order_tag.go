package selling_service_models

import "time"

// OrderTag is a row of `order_tags` (00055) — THE ORDERS' OWN TAG LIST (backlog #100, orders-have-their-own-tag-list):
// apart from the restocks' list (inventory's `tags`), one list for every team, a name unique within it. Schema owned by
// goose (db_migrations); GORM only reads and writes rows.
//
//   - Name is kept trimmed with its inner spaces folded to one, the case as first typed; the database CHECKs that shape
//     and refuses a second order tag whose name equals it case-insensitively (a unique index on lower(name)).
//   - Type is "system" (made, put on and taken off only by Root / the Administrator) or "custom" (made freely by anyone
//     who may write on an order) — a-restock-tag-is-system-or-custom, on the orders' list. CHECKed.
//   - No app task: the app owns no order tag for now (the 🔄 "A" under orders-have-their-own-tag-list).
//   - Who made it: an opaque user_service id and whether they were an override (an-override-is-stamped-in-every-service).
type OrderTag struct {
	ID   uint64 `gorm:"primaryKey"`
	Name string
	Type string

	CreatedByUserID     uint64
	CreatedByIsOverride bool

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (OrderTag) TableName() string {
	return "order_tags"
}
