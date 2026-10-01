package financial_account_service_models

import "time"

// EventLogTable is the withdrawal listener's claim table — bound once, in san_event.NewDedup.
const EventLogTable = "financial_account_event_logs"

// FinancialAccountEventLog is a row of `financial_account_event_logs` — an event already posted, so a
// redelivery posts nothing (one-contract-for-both-handler-types).
type FinancialAccountEventLog struct {
	EventID        string `gorm:"primaryKey"`
	OccurredAtUnix int64
	ReceivedAt     time.Time
}

func (FinancialAccountEventLog) TableName() string {
	return EventLogTable
}
