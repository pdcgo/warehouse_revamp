package inventory_service_models

import "time"

// OpnameSessionFinalTransaction is a row of `opname_session_final_transactions` — a transaction a session's finalize
// wrote (a-session-lists-its-final-transactions). Listed means the problem or found came through a count; not listed, a
// report at the shelf.
type OpnameSessionFinalTransaction struct {
	ID              uint64 `gorm:"primaryKey"`
	OpnameSessionID uint64
	TransactionID   uint64
	CreatedAt       time.Time
}

func (OpnameSessionFinalTransaction) TableName() string {
	return "opname_session_final_transactions"
}
