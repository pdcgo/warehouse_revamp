package liability_service_models

import "time"

// LiabilityTerms is a row of `liability_terms` — a CREDITOR'S terms toward one debtor (#186/#189):
// how far it will let them run.
//
// `CounterpartyID = 0` is the DEFAULT row, applying to every team without one of their own. The
// lookup is "this debtor's row, else the default, else nothing" — and "nothing" means allow anything,
// because a creditor that has configured nothing is not limiting.
type LiabilityTerms struct {
	ID uint64 `gorm:"primaryKey"`

	// The creditor who set these, and who they apply to. Opaque team_service ids; no FK.
	TeamID         uint64
	CounterpartyID uint64

	// ⛔ No fee here any more (00011). The flat `handling_fee` was dropped at step 5 of the-flat-rate-is-dropped-last:
	// the warehouse's fee is warehouse_service's, frozen on each order and posted from `OrderPlaced`. No markup either:
	// it is the PRODUCT's, frozen on each order line's total (the-ledger-charges-the-frozen-line-total).

	// ⚠ nil is UNLIMITED; 0 is NO CREDIT AT ALL. Removing a limit deletes the row.
	CreditLimit *int64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (LiabilityTerms) TableName() string {
	return "liability_terms"
}
