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
	HandlingFee int64

	// Basis points over the goods' cost (2000 = 20%). Basis points rather than a float for the same
	// reason money is int64.
	ProductMarkupBP int64 `gorm:"column:product_markup_bp"`

	// ⚠ nil is UNLIMITED; 0 is NO CREDIT AT ALL. Removing a limit deletes the row.
	CreditLimit *int64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (LiabilityTerms) TableName() string {
	return "liability_terms"
}
