package expense_service_models

import "time"

// ExpenseRecord is a row of `expense_records` (#161) — money the business spent that NO ORDER caused.
//
// The defining fact is that A PERSON TYPED IT. A revenue row is written by the system from an order
// and frozen; this is entered by hand about a period, so it can be wrong — hence correctable, hence
// CreatedBy, hence VoidedAt rather than a delete.
type ExpenseRecord struct {
	ID uint64 `gorm:"primaryKey"`

	// The scope. ONE team per row: a warehouse IS a team, so warehouse payroll is a cost on that
	// warehouse, never recharged onward to the selling teams it serves (owner, 2026-07-21).
	TeamID uint64
	// Optional, on any kind. 0 = not attributed to one shop. Opaque selling_service id.
	ShopID uint64

	// ExpenseKind's enum number. Mapped in the handler — proto enums are open, so the database does not
	// get to decide which values are legal (cf. #80).
	Kind int32

	// Whole rupiah, always positive (DB CHECK). The kind carries the direction; a signed amount would
	// let a negative cost silently become revenue.
	Amount int64

	// The date the cost BELONGS TO, as chosen — not the insert time. Payroll paid on the 5th is last
	// month's cost, and filing it under the 5th puts it in the wrong month.
	OccurredAt time.Time

	Note string

	// Who typed it. Opaque user_service id.
	CreatedBy uint64

	// nil while the row still counts. Voided rather than deleted (#164): a deleted row cannot tell you
	// a cost was entered and then retracted.
	VoidedAt *time.Time

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (ExpenseRecord) TableName() string {
	return "expense_records"
}
