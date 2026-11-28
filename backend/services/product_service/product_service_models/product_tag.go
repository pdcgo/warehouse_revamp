package product_service_models

import "time"

// ProductTag is a row of `product_tags` (00010) — THE PRODUCTS' OWN TAG LIST (backlog #147, products-have-their-own-tag-list):
// apart from the orders' list (selling's `order_tags`) and the restocks' (inventory's `tags`), one list for every team, a
// name unique within it. Schema owned by goose (db_migrations); GORM only reads and writes rows.
//
//   - Name is kept trimmed with its inner spaces folded to one, the case as first typed; the database CHECKs that shape
//     and refuses a second product tag whose name equals it case-insensitively (a unique index on lower(name)).
//   - Type is "system" (made, put on and taken off only by Root / the Administrator and the app's own tasks) or "custom"
//     (made, put on and taken off by anyone who may write on the product) — a-restock-tag-is-system-or-custom, on the
//     products' list. CHECKed.
//   - AppTask names the app's own task that owns a SYSTEM tag — "product.code.reprint" (`need_reprint_code`, seeded by
//     00010); "" otherwise. Unique where set. A tag with one is LOCKED for everyone, admins included.
//   - Who made it: an opaque user_service id (0 = the app) and whether they were an override
//     (an-override-is-stamped-in-every-service).
type ProductTag struct {
	ID      uint64 `gorm:"primaryKey"`
	Name    string
	Type    string
	AppTask string

	CreatedByUserID     uint64
	CreatedByIsOverride bool

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (ProductTag) TableName() string {
	return "product_tags"
}
