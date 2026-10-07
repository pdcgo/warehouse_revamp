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
)

// FinancialAccountLog is a row of `financial_account_logs` — one move of one account's balance.
// Append-only: a mistake is corrected by a further row.
type FinancialAccountLog struct {
	ID               uint64 `gorm:"primaryKey"`
	TeamID           uint64
	AccountID        uint64
	ChangeType       string
	Change           float64 `gorm:"type:numeric(20,2)"`
	BalanceAfter     float64 `gorm:"type:numeric(20,2)"`
	Description      string
	ActorID          uint64
	OccurredAt       time.Time
	GroupID          uint64
	CounterAccountID uint64
	CreatedAt        time.Time
}

func (FinancialAccountLog) TableName() string {
	return "financial_account_logs"
}
