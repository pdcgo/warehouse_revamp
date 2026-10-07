package settlement_service_models

import "time"

// ShopSettlementDailyReport is a row of `shop_settlement_daily_reports` (00005) — one shop's movement and
// position on one Jakarta day. DERIVED: written only by the fold, rebuilt by a replay.
//
// ⚠ A day with no movement has NO row. Its position is the last row at or before it.
type ShopSettlementDailyReport struct {
	ID     uint64    `gorm:"primaryKey"`
	Day    time.Time `gorm:"type:date"`
	ShopID uint64
	TeamID uint64

	SettlementMetricColumns `gorm:"embedded"`

	LastUpdated time.Time
}

func (ShopSettlementDailyReport) TableName() string {
	return "shop_settlement_daily_reports"
}
