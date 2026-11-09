package selling_service_models

import "time"

// OrderTimelineLog is a row of `order_timeline_logs` (00017) — one entry on an order's timeline: a STATUS CHANGE,
// or a NOTE written while working it, with who wrote it and from which side
// (order-timeline-logs-replaces-order-events). Append-only. Schema owned by goose (db_migrations).
type OrderTimelineLog struct {
	ID      uint64 `gorm:"primaryKey"`
	OrderID uint64

	// The status the order moved INTO, as text ("picked"). "" = a note only, no move.
	Status string

	// Why, on a move that needed a reason (back to pending), or the note itself.
	Note string

	// Which side wrote it: "warehouse" or "selling". `from` is an SQL keyword, so the column is always quoted —
	// GORM does that in what it generates; a hand-written query must too.
	From string `gorm:"column:from"`

	// WHO, as an opaque user_service id (no FK, like every cross-service id here). 0 = not recorded.
	ActorID uint64

	// Whether that person was OUTSIDE the team the call was scoped to (00033) — Root or the Administrator in by the
	// root-team bypass (an-override-is-stamped-in-every-service). Derived by the server, never sent by the caller.
	IsOverride bool

	// WHERE A RETURN WAS ACCEPTED (00034, the-accept-records-where-it-was-accepted) — the warehouse team whose staff
	// accepted it, on the `return_completed` row only. 0 on every other row. Opaque team_service id.
	AcceptingWarehouseID uint64

	// When it happened — the row is written at that moment, so the two are one.
	CreatedAt time.Time
}

func (OrderTimelineLog) TableName() string {
	return "order_timeline_logs"
}
