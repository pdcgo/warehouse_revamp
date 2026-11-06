package expense_service_models

import "time"

// ExpenseMetricDailyReport is a row of `expense_metric_daily_reports` — what one team's TYPED expenses of one kind, one
// shop and one person add up to on one Jakarta day, as the Analytic composer reads them (expense-has-ads-and-expenses).
// Written in the expense row's own transaction (expense_v1.foldMetric): an expense on its `occurred_at`, a correction
// on the day it is made, for whoever made it (an-expense-correction-counts-on-the-day-it-is-made,
// an-expense-correction-counts-for-who-made-it). Never a STOCK_LOSS (stock-loss-stays-out-of-analytic-expenses).
type ExpenseMetricDailyReport struct {
	ID  uint64 `gorm:"primaryKey"`
	Day time.Time

	// Whose expense — the reader's scope.
	TeamID uint64
	// The same team on its side of the composer (the-warehouse-is-its-own-group): a selling team under Seller, a
	// warehouse team under Warehouse; 0 on the other side (both 0 for the root team).
	SellerID    uint64
	WarehouseID uint64

	// ExpenseKind's number — ADS 1 … OTHER 4.
	Kind int32
	// An ads expense's shop; 0 on every other kind.
	ShopID uint64
	// Who made the entry — the typer of an expense, the corrector of a correction.
	UserID uint64

	// Exact and signed (the-backend-never-rounds-money).
	Amount float64 `gorm:"type:double precision"`

	LastUpdated time.Time
}

func (ExpenseMetricDailyReport) TableName() string {
	return "expense_metric_daily_reports"
}
