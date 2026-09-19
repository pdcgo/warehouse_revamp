package inventory_service_models

import "time"

// RestockRequestEvent is a row of `restock_request_events` (00019) — one thing that happened to a
// restock, in the order it happened. Schema owned by goose; GORM only reads and writes rows.
//
// APPEND ONLY. Nothing here is ever updated or deleted, which is why there is no UpdatedAt: an event
// is a claim that something happened at a moment, and a mutable history is not a history.
//
// `Kind` is stored as text and mapped in the handler layer (no DB CHECK IN-list, cf. #80), so adding
// a kind is a constant rather than a migration.
type RestockRequestEvent struct {
	ID               uint64 `gorm:"primaryKey"`
	RestockRequestID uint64
	Kind             string

	// WHO, as an opaque user_service id (no FK, like every cross-service id here). 0 = not recorded —
	// true of a backfilled row whose actor the old columns never captured, and of anything a system
	// process ever does.
	ActorUserID uint64

	// WHEN IT HAPPENED, which is not when the row was written: the 00019 backfill inserts events for
	// deliveries accepted months ago. The timeline orders by this.
	At time.Time

	CreatedAt time.Time
}

func (RestockRequestEvent) TableName() string {
	return "restock_request_events"
}
