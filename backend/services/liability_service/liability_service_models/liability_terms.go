package liability_service_models

import "time"

// LiabilityTerms is a row of `liability_terms` — a CREDITOR'S terms toward one debtor (#186/#189):
// what it charges them, and how far it will let them run.
//
// `CounterpartyID = 0` is the DEFAULT row, applying to every team without one of their own. The
// lookup is "this debtor's row, else the default, else nothing" — and "nothing" means charge nothing
// and allow anything, because a creditor that has configured nothing is neither billing nor limiting.
type LiabilityTerms struct {
	ID uint64 `gorm:"primaryKey"`

	// The creditor who set these, and who they apply to. Opaque team_service ids; no FK.
	TeamID         uint64
	CounterpartyID uint64

	// Flat per order, whole rupiah. 0 = charge nothing.
	//
	// ⛔ No markup beside it any more: the markup is the PRODUCT's, applied by inventory's take and frozen on each
	// order line's total (the-ledger-charges-the-frozen-line-total).
	HandlingFee int64

	// ⚠ nil is UNLIMITED; 0 is NO CREDIT AT ALL. Removing a limit deletes the row.
	CreditLimit *int64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (LiabilityTerms) TableName() string {
	return "liability_terms"
}
