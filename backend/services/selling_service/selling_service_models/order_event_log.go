package selling_service_models

import "time"

// OrderEventLog is a row of `order_event_logs` (00030) — one event the order metrics' fold has already applied. The
// claim is the write: a second delivery finds the row and folds nothing.
type OrderEventLog struct {
	// The event's own id — "order-placed:<order_id>", "order-status-changed:<timeline_log_id>" — never the broker's.
	ID string `gorm:"primaryKey"`
	// The event as received, protojson.
	Raw []byte
	// The Jakarta day the figures went to.
	Day       time.Time
	CreatedAt time.Time
}

func (OrderEventLog) TableName() string {
	return "order_event_logs"
}
