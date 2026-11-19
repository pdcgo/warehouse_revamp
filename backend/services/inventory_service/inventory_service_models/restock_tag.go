package inventory_service_models

import "time"

// RestockTag is a row of `restock_tags` (00055) — one tag on one restock (backlog #87). A restock's tags are ONE set,
// the same on both sides (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps); the pair is the key, so a tag
// is on a restock once. Deleting a tag takes it off every restock (ON DELETE CASCADE, under the tag's row lock).
//
// Who put it on, and when: an opaque user_service id — 0 = the APP (Terima's problem tags, the migration's backfill) —
// and whether that person was an override (an-override-is-stamped-in-every-service).
type RestockTag struct {
	RestockID uint64 `gorm:"primaryKey;autoIncrement:false"`
	TagID     uint64 `gorm:"primaryKey;autoIncrement:false"`

	AddedByUserID     uint64
	AddedByIsOverride bool
	AddedAt           time.Time
}

func (RestockTag) TableName() string {
	return "restock_tags"
}
