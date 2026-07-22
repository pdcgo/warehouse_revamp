package settlement_service_models

import "time"

// SettlementBalance is a row of `settlement_balances` — the running total for one ORDERED PAIR of
// teams, and a PROJECTION of the entries rather than a fact of its own.
//
// Two rows exist per relationship, one from each side, holding exact negatives. That is deliberate:
// both teams read their own position with the same query and the same sign convention, and neither
// has to remember which way round the pair was stored.
type SettlementBalance struct {
	ID             uint64 `gorm:"primaryKey"`
	TeamID         uint64
	CounterpartyID uint64

	// Positive = they owe you. Same convention as SettlementEntry.Amount.
	Balance int64

	// When the current run of debt began; nil when the pair is square. Set as the balance leaves
	// zero, cleared as it returns — so paying in full resets the clock and a partial payment does not.
	OldestUnsettledAt *time.Time

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (SettlementBalance) TableName() string {
	return "settlement_balances"
}
