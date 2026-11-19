package inventory_service_models

import "time"

// Tag is a row of `tags` (00055) — ONE APP-WIDE LIST of the tags a restock can carry (backlog #87,
// custom-tags-are-shared-system-tags-are-the-admins-and-the-apps): every team's, a name unique across it. Schema owned by
// goose (db_migrations); GORM only reads and writes rows.
//
//   - Name is kept trimmed with its inner spaces folded to one, the case as first typed; the database CHECKs that shape
//     and refuses a second tag whose name equals it case-insensitively (a unique index on lower(name)).
//   - Type is "system" (owned by the system — made, put on and taken off only by Root / the Administrator and the app's
//     own tasks) or "custom" (made freely by any user who may tag) — a-restock-tag-is-system-or-custom. CHECKed.
//   - AppTask names the app's own task that owns a SYSTEM tag — "restock.problem.missing" (*Barang kurang*) and
//     "restock.problem.broken" (*Barang rusak*), seeded by the migration and put on by Terima
//     (a-restock-problem-is-a-system-tag); "" otherwise. Unique where set. A tag with one is LOCKED for everyone.
//   - Who made it: an opaque user_service id (0 = the app) and whether they were an override
//     (an-override-is-stamped-in-every-service).
type Tag struct {
	ID      uint64 `gorm:"primaryKey"`
	Name    string
	Type    string
	AppTask string

	CreatedByUserID     uint64
	CreatedByIsOverride bool

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Tag) TableName() string {
	return "tags"
}
