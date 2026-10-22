package inventory_service_models

import "time"

// RestockLog is a row of `restock_logs` (00024, keyed by restock since 00030) — one entry in a restock's trail: every
// status change, and every edit, in the order it happened (every-status-change-is-logged, edits-are-in-the-same-trail).
// Schema owned by goose; GORM only reads and writes rows.
//
// APPEND ONLY. Nothing here is ever updated or deleted, which is why there is no UpdatedAt: a log row is a claim that
// something happened at a moment, and a mutable history is not a history.
type RestockLog struct {
	ID        uint64 `gorm:"primaryKey"`
	RestockID uint64

	// Status words as Restock.Status stores them. "" as FromStatus is the create: nothing came before it. An edit keeps
	// the status, so FromStatus equals ToStatus and Description says what changed.
	FromStatus string
	ToStatus   string

	// WHO, as an opaque user_service id (no FK). 0 = not recorded — true of a backfilled row whose actor nobody
	// captured.
	ActorUserID uint64
	Description string

	// WHEN IT HAPPENED. The writer sets it to the instant of the change it records, so the trail and the column the
	// handler stamps agree; the trail orders by it.
	CreatedAt time.Time
}

func (RestockLog) TableName() string {
	return "restock_logs"
}
