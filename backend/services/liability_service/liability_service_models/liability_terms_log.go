package liability_service_models

import "time"

// LiabilityTermsLog is a row of `liability_terms_logs` — one change to one creditor's terms toward
// one debtor (a-limit-change-is-recorded).
//
// ⚠ IT IS NOT THE LEDGER, AND IT IS NOT `LiabilityLog`. The pair detail shows both and they must
// never merge (the-pair-detail-shows-both-logs): this records a RULE that changed, `LiabilityLog`
// records MONEY that moved. Only the second is a ledger — its rows come in balancing pairs and sum
// to zero. These stand alone.
//
// Schema owned by goose; GORM only reads and writes rows.
type LiabilityTermsLog struct {
	ID uint64 `gorm:"primaryKey"`

	// The creditor whose terms these are, and the debtor they apply to. ⚠ 0 IS THE DEFAULT ROW.
	TeamID         uint64
	CounterpartyID uint64

	// Opaque user_service id; 0 when the write carried no identity.
	ActorID uint64

	// ⚠ POINTERS, AND NOT FOR TIDINESS. `nil`, `0` and a number are THREE different acts — unlimited,
	// frozen, and a real ceiling — and an int64 flattens the first into the second, recording "they
	// removed the limit" as "they froze the team". Those are opposites, and the wrong one of the two
	// is the one that stops a team trading.
	OldCreditLimit *int64
	NewCreditLimit *int64

	// No third state for these two: 0 means "charge nothing" for both.
	OldHandlingFee     int64
	NewHandlingFee     int64
	OldProductMarkupBp int64
	NewProductMarkupBp int64

	// Required when Override is true, optional otherwise.
	Reason string

	// TRUE when the actor held no role in the creditor team. Derived from the role the interceptor
	// resolved, never from anything the caller sent.
	Override bool

	// ⚠ `autoCreateTime` IS REQUIRED, and its absence is not a style slip — it writes the WRONG DATA.
	// GORM fills timestamps by NAME (`CreatedAt` / `UpdatedAt`), and this column is called `changed_at`
	// because a terms change is not a row being created. Without the tag GORM inserts Go's zero time
	// EXPLICITLY, so the column's `DEFAULT NOW()` never fires and every entry is stamped year 1 — which
	// also silently reverses `ORDER BY changed_at DESC`, the ordering the whole screen depends on.
	ChangedAt time.Time `gorm:"autoCreateTime"`
}

func (LiabilityTermsLog) TableName() string {
	return "liability_terms_logs"
}
