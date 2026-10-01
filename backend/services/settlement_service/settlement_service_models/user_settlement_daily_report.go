package settlement_service_models

import "time"

// UserSettlementDailyReport is a row of `user_settlement_daily_reports` (00005) — one user's movement and
// position on one Jakarta day. DERIVED, like the shop grain.
//
// The user is who CREATED THE ORDER for an order-addressed row, and who POSTED a shop-addressed one.
// UserID 0 is "not recorded", kept as a row so user totals still sum to shop totals.
type UserSettlementDailyReport struct {
	ID     uint64    `gorm:"primaryKey"`
	Day    time.Time `gorm:"type:date"`
	UserID uint64
	TeamID uint64

	SettlementMetricColumns `gorm:"embedded"`

	LastUpdated time.Time
}

func (UserSettlementDailyReport) TableName() string {
	return "user_settlement_daily_reports"
}
