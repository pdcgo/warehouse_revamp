package expense_service_models

import "time"

// EventLogTable is the capital listener's claim table — bound once, in san_event.NewDedup (expense_v1/service.go).
const EventLogTable = "expense_event_logs"

// ExpenseEventLog is a row of `expense_event_logs` — an event already handled, so a redelivery records nothing
// (one-contract-for-both-handler-types). Today only the account's FinancialAccountCapitalRecorded arrives here.
type ExpenseEventLog struct {
	EventID        string `gorm:"primaryKey"`
	OccurredAtUnix int64
	ReceivedAt     time.Time
}

func (ExpenseEventLog) TableName() string {
	return EventLogTable
}
