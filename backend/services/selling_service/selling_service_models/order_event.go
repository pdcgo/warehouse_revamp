package selling_service_models

import "time"

// OrderEvent is a row of `order_events` (00011) — one thing that happened to an order, in the order it
// happened. Schema owned by goose; GORM only reads and writes rows.
//
// APPEND ONLY. Nothing here is ever updated or deleted, which is why there is no UpdatedAt: an event
// is a claim that something happened at a moment, and a mutable history is not a history.
//
// `Kind` is stored as text and mapped in the handler layer (no DB CHECK IN-list, cf. #80), so adding a
// kind is a constant rather than a migration.
type OrderEvent struct {
	ID      uint64 `gorm:"primaryKey"`
	OrderID uint64
	Kind    string

	// WHO, as an opaque user_service id (no FK, like every cross-service id here). 0 = not recorded —
	// true of every backfilled row, whose actor the orders table never captured, and of anything a
	// system process ever does.
	ActorUserID uint64

	// WHEN IT HAPPENED, which is not when the row was written: the 00011 backfill inserts events for
	// orders placed months ago. The timeline orders by this.
	At time.Time

	CreatedAt time.Time
}

func (OrderEvent) TableName() string {
	return "order_events"
}
