package revenue_service_models

import "time"

// OrderRevenue is a row of `order_revenues` (#75) — what one order was EXPECTED to make, frozen when
// the order was placed.
//
// team_id and order_id are OPAQUE cross-service ids (selling_service) — no FK (HARD RULE 3).
//
// The money is COPIED from the order rather than referenced, on purpose: this row must still read
// correctly if the order is later edited, or if the rule that produced its cost changes (#74's cost
// rule is explicitly replaceable). A record that silently followed the order would stop being a record
// of what was expected AT THE TIME, which is the only thing it is for.
type OrderRevenue struct {
	ID      uint64 `gorm:"primaryKey"`
	TeamID  uint64
	OrderID uint64

	// Whole rupiah, all frozen at order time.
	Revenue      int64 // what the buyer paid — the order's total
	COGS         int64 `gorm:"column:cogs"`
	ShippingCost int64

	// revenue − cogs − shipping_cost, computed once and STORED rather than derived on read: #76 will
	// reconcile it against an actual, and a number you reconcile against has to be the one you actually
	// promised — not one recomputed later from inputs that may since have been corrected.
	ExpectedMargin int64

	// Whether COGS is a real figure or a stand-in for "we do not know" (#74). 0 is a legitimate cost as
	// well as the unknown marker, so the two cannot be told apart without this.
	CostKnown bool

	// When this row stopped counting (#164) — nil while it still does. The order was cancelled, so it
	// earned nothing, and every total excludes it.
	//
	// A timestamp rather than a boolean because "when did this stop counting" is the next question
	// anybody asks, and a boolean cannot answer it.
	VoidedAt *time.Time

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (OrderRevenue) TableName() string {
	return "order_revenues"
}
