package liability_service_models

import "time"

// LiabilityPayment is a row of `liability_payments` (#188) — one team's claim that it paid another,
// and the creditor's agreement that the money arrived.
//
// ⚠ IT IS NOT THE LEDGER. This table records the claim; `liability_logs` records what moved. A
// payment sitting at RECORDED has changed no balance at all — only CONFIRMED posts, because only the
// creditor can see the money land, and one side asserting a transfer is not evidence that it did.
//
// Schema owned by goose; GORM only reads and writes rows.
type LiabilityPayment struct {
	ID uint64 `gorm:"primaryKey"`

	// Who paid, who was paid. Opaque team_service ids; no FK. NOT interchangeable — only
	// CreditorTeamID may confirm, and that asymmetry is the whole two-phase design.
	PayerTeamID    uint64
	CreditorTeamID uint64

	// Whole rupiah, always positive. Direction lives in the two ids above, never in a sign.
	Amount int64

	// recorded | confirmed | reversed — see the mapper. Text rather than an enum column for the same
	// reason `liability_logs.source_type` is.
	Status string

	// The payer's hint for the human confirming: a transfer reference, a bank, a date.
	Note string

	// Why a confirmation was undone. Empty unless Status is reversed.
	ReversalReason string

	// Opaque user ids; 0 when unknown. Who claimed and who agreed.
	RecordedBy  uint64
	ConfirmedBy uint64

	CreatedAt time.Time
	// nil until the creditor confirms. Survives a reversal — when it was agreed is a fact, and the
	// reversal is a later one.
	ConfirmedAt *time.Time
	UpdatedAt   time.Time
}

func (LiabilityPayment) TableName() string {
	return "liability_payments"
}
