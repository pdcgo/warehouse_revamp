package financial_account_service_models

import "time"

// The text values of `financial_account_logs.change_type` — one way in each (one-way-in-per-type).
const (
	ChangeExpense        = "expense"
	ChangeAdsExpense     = "ads_expense"
	ChangeAdjustment     = "adjustment"
	ChangeWithdrawal     = "withdrawal"
	ChangeRestock        = "restock"
	ChangeOpeningBalance = "opening_balance"
	ChangeTransfer       = "transfer"
	ChangeTeamPayment    = "team_payment"
	ChangeCapital        = "capital"
	// Money IN typed on Biaya — Piutang luar diterima, Uang masuk lain (money-in-on-biaya-is-its-own-change-type).
	ChangeMoneyIn = "money_in"
)

// FinancialAccountLog is a row of `financial_account_logs` — one move of one account's balance.
// Append-only: a mistake is corrected by a further row.
type FinancialAccountLog struct {
	ID               uint64 `gorm:"primaryKey"`
	TeamID           uint64
	AccountID        uint64
	ChangeType       string
	Change           float64 `gorm:"type:double precision"`
	BalanceAfter     float64 `gorm:"type:double precision"`
	Description      string
	ActorID          uint64
	OccurredAt       time.Time
	GroupID          uint64
	CounterAccountID uint64
	CreatedAt        time.Time

	// Root or the Administrator posted it inside a team they hold no role in (an-override-is-stamped-in-every-service).
	// A listener's row carries the flag its event names beside the actor (`actor_is_override`).
	IsOverride bool

	// The expense_service expense the row was posted from — every row the expense listener posts; 0 otherwise. The
	// account history's *dari Biaya #N* (the-expense-types-prototype-is-accepted). Another service's id: no FK.
	ExpenseID uint64
}

func (FinancialAccountLog) TableName() string {
	return "financial_account_logs"
}
