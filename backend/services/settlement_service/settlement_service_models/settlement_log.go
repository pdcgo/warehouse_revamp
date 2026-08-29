package settlement_service_models

import "time"

// SettlementLog is a row of `settlement_logs` — one movement on one order's marketplace account.
//
// IMMUTABLE. Nothing updates or deletes a row: a correction is a compensating entry, because a ledger
// you can edit is not evidence of anything. Schema owned by goose; GORM only reads and inserts.
type SettlementLog struct {
	ID uint64 `gorm:"primaryKey"`

	// THE SCOPE. Opaque selling_service ids; no FK, because those tables belong to another service.
	OrderID uint64
	ShopID  uint64
	TeamID  uint64

	// Who is ANSWERABLE — the person in charge, not the session that wrote the row. Set even on
	// machine rows.
	ActorID uint64

	// The enums as text (see mapper.go), matching `orders.status` and `liability_entries`.
	SourceType     string
	SettlementType string

	// ⚠ POSITIVE IS MONEY TOWARD US. `initial_total` is NEGATIVE, `fund` is POSITIVE. Whole rupiah.
	Change int64

	// The running position after this row. Derived; the log stays what it is derived from.
	Balance int64

	// The caller's idempotency key, unique with OrderID.
	UniqueID string

	// The day the money belongs to, and the day we learned it. Apart on a late fee.
	OccurredOn time.Time `gorm:"type:date"`
	PostedOn   time.Time `gorm:"type:date"`

	// Points backwards at the row this one undoes, or nil. Nothing ever points forwards.
	ReversesID *uint64

	Note string

	CreatedAt time.Time
}

func (SettlementLog) TableName() string {
	return "settlement_logs"
}
