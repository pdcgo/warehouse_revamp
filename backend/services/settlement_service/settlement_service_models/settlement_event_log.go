package settlement_service_models

import "time"

// SettlementEventLog is a row of `settlement_event_logs` (00005) — one event the fold has already applied.
//
// ⚠ ID IS THE EVENT's id, never the broker's message id: a retried publish mints a new message id for the
// same fact. Day is the folded row's `posted_on`, the predicate a replay deletes on.
type SettlementEventLog struct {
	ID        string `gorm:"primaryKey"`
	Raw       []byte
	Day       time.Time `gorm:"type:date"`
	CreatedAt time.Time
}

func (SettlementEventLog) TableName() string {
	return "settlement_event_logs"
}
