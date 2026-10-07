package settlement_service_models

import "time"

// ShopSettlementReport is a row of `shop_settlement_reports` (00005) — a shop's LATEST close_balance.
//
// ⚠ Derived from the newest daily row and rewritten by every fold, never incremented, so a replay's
// redelivery re-derives it rather than doubling it.
type ShopSettlementReport struct {
	ID           uint64 `gorm:"primaryKey"`
	ShopID       uint64
	TeamID       uint64
	CloseBalance int64
	LastUpdated  time.Time
}

func (ShopSettlementReport) TableName() string {
	return "shop_settlement_reports"
}
