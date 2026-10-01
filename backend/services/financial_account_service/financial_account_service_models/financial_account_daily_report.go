package financial_account_service_models

import "time"

// MetricColumns are the figures of one daily row — and of any window summed from them.
//
// ⚠ EXPORTED, and embedded by every scan target: GORM does not scan into an embedded struct whose type is
// unexported, and silently leaves every figure at zero.
type MetricColumns struct {
	Expense        float64
	AdsExpense     float64
	Adjustment     float64
	Withdrawal     float64
	Restock        float64
	OpeningBalance float64
	Transfer       float64
	TeamPayment    float64
	Capital        float64
	Change         float64
	OpenBalance    float64
	CloseBalance   float64
}

// FinancialAccountDailyReport is a row of `financial_account_daily_reports` — one account's movement on
// one Jakarta day (the-daily-row-is-one-account-one-day). Written by the ledger's post, in the log row's
// own transaction (the-daily-row-is-written-with-the-log-row).
type FinancialAccountDailyReport struct {
	ID        uint64 `gorm:"primaryKey"`
	Day       time.Time
	AccountID uint64
	TeamID    uint64
	MetricColumns
	LastUpdated time.Time
}

func (FinancialAccountDailyReport) TableName() string {
	return "financial_account_daily_reports"
}
