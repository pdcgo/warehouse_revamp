package settlement_service_models

import "time"

// SettlementEntry is a row of `settlement_entries` (#183) — ONE LEG of one movement between two
// teams. Every posting writes two of these in one transaction, so posting half a movement is
// impossible.
//
// IMMUTABLE. Nothing updates or deletes an entry: a correction is a compensating entry, because a
// ledger you can edit is not evidence of anything. Schema owned by goose; GORM only reads/writes.
type SettlementEntry struct {
	ID uint64 `gorm:"primaryKey"`

	// Whose books this leg is in, and who the other side is. Opaque team_service ids; no FK.
	TeamID         uint64
	CounterpartyID uint64

	// ⚠ From TeamID's point of view: a RECEIVABLE is POSITIVE, a PAYABLE is NEGATIVE. Whole rupiah.
	// The two legs of one movement are exact negatives of each other.
	Amount int64

	// What caused it. SourceType is the enum as text (see mapper.go); SourceID is an opaque id in
	// whichever service owns that thing.
	SourceType string
	SourceID   uint64

	// Whether this leg undoes an earlier one — and part of the idempotency key, not a display flag.
	Reversal bool

	// Shared by both legs of one movement, from `settlement_group_seq`.
	GroupID uint64

	// The balance on this side after this entry. Derived, kept for the history screen; the entries
	// stay what it is derived from.
	BalanceAfter int64

	CreatedAt time.Time
}

func (SettlementEntry) TableName() string {
	return "settlement_entries"
}
