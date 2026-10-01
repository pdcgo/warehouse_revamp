package liability_service_models

import "time"

// LiabilityLog is a row of `liability_logs` (#183) — ONE LEG of one movement between two teams.
// Every posting writes two of these in one transaction, so posting half a movement is impossible.
//
// ⚠ IT IS A LOG WHOSE ROWS ARE NOT INDEPENDENT (two-logs-two-names). The name is the word the design
// docs use for what the screen shows; `GroupID` is what pairs the two legs, and `PostEntry` being the
// only writer is what keeps a half-movement from existing. The noun guarantees nothing.
//
// IMMUTABLE. Nothing updates or deletes an entry: a correction is a compensating entry, because a
// ledger you can edit is not evidence of anything. Schema owned by goose; GORM only reads/writes.
type LiabilityLog struct {
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

	// Shared by both legs of one movement, from `liability_group_seq`.
	GroupID uint64

	// The balance on this side after this entry. Derived, kept for the history screen; the log rows
	// stay what it is derived from.
	BalanceAfter int64

	// WHO CAUSED IT — a user id, opaque here (every-entry-names-who-posted-it). The human whose act
	// produced the movement, not the service that wrote the row: a team disputing a charge has to be
	// able to see a person.
	//
	// ⚠ 0 MEANS A GENUINELY UNATTENDED POSTING — a scheduled job — and nothing writes it today.
	// Rows written before this column existed carry 0 and cannot be back-filled: the fact was never
	// recorded anywhere to recover it from.
	ActorID uint64

	CreatedAt time.Time
}

func (LiabilityLog) TableName() string {
	return "liability_logs"
}
