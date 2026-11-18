package inventory_service_models

// RestockLogChange is a row of `restock_log_changes` (00049) — ONE thing an edit changed, before and after
// (edits-are-in-the-same-trail): *Kaos 10 → 12, extra stock* is a `line_count` row and a `line_note` row under the
// edit's RestockLog. Schema owned by goose; GORM only reads and writes rows.
//
// APPEND ONLY, like the trail it belongs to — written in the edit's transaction, never updated. An edit written before
// the table existed has none, and reads as the bare "edited" it always did.
type RestockLogChange struct {
	ID           uint64 `gorm:"primaryKey"`
	RestockLogID uint64

	// Which field: the restock's own (`warehouse`, `receipt`, … `note`) or a line's (`line_added`, `line_count`, …),
	// CHECKed in the migration.
	Field string

	// The line it is about — 0 for the restock's own field — and the name the restock carried for it at the edit.
	ProductID   uint64
	ProductName string

	// The values as text: a count or an amount in decimal, an id in decimal, words verbatim; "" is none.
	BeforeValue string
	AfterValue  string
}

func (RestockLogChange) TableName() string {
	return "restock_log_changes"
}
