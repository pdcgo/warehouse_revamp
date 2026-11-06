package expense_service_models

import "time"

// ExpenseRecord is a row of `expense_records` (#161) — money the business spent that NO ORDER caused.
//
// The defining fact is that A PERSON TYPED IT. A revenue row is written by the system from an order
// and frozen; this is entered by hand about a period, so it can be wrong — hence correctable, hence
// CreatedBy. It is corrected by a NEW ROW, an adjustment, never by an edit
// (every-correction-is-a-signed-adjustment): a row never changes after it is saved.
type ExpenseRecord struct {
	ID uint64 `gorm:"primaryKey"`

	// The scope. ONE team per row: a warehouse IS a team, so warehouse payroll is a cost on that
	// warehouse, never recharged onward to the selling teams it serves (owner, 2026-07-21).
	TeamID uint64
	// The shop an ADS expense ran for — required on ADS, refused on every other kind (an-expense-names-a-shop-only-for-ads).
	// 0 = no shop. A row made before that rule keeps whatever shop it carries. Opaque selling_service id.
	ShopID uint64

	// ExpenseKind's enum number. Mapped in the handler — proto enums are open, so the database does not
	// get to decide which values are legal (cf. #80).
	Kind int32

	// Exact rupiah, never rounded (the-backend-never-rounds-money); the sign is a DB CHECK. Positive on an expense — the kind carries the direction, and a signed amount would let a
	// negative cost silently become revenue. Signed and never 0 on an adjustment: the correction, not a new total.
	Amount float64

	// The date the cost BELONGS TO, as chosen — not the insert time. Payroll paid on the 5th is last
	// month's cost, and filing it under the 5th puts it in the wrong month.
	OccurredAt time.Time

	Note string

	// Who typed it. Opaque user_service id.
	CreatedBy uint64
	// Root or the Administrator typed it inside a team they hold no role in (an-override-is-stamped-in-every-service).
	// Server-derived from the interceptor's resolved role, never sent by the caller.
	IsOverride bool

	// 0 on an expense. On an adjustment, the expense it corrects — whose team, shop, kind and day it copies, so it counts
	// where the mistake is (an-adjustment-counts-on-the-day-it-fixes). Never another adjustment.
	AdjustsExpenseID uint64

	// The account that paid — a financial_account_service id, one of the team's active operational accounts when the
	// expense was recorded (an-expense-must-name-the-account-that-paid). On an adjustment, its expense's, copied
	// (a-correction-follows-the-expenses-account). 0 = made before *Paid from*, or a STOCK_LOSS: nothing posts for it.
	FinanceAccountID uint64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (ExpenseRecord) TableName() string {
	return "expense_records"
}
