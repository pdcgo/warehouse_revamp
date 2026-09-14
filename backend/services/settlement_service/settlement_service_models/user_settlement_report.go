package settlement_service_models

import "time"

// UserSettlementReport is a row of `user_settlement_reports` (00005) — a user's LATEST close_balance,
// derived exactly as ShopSettlementReport is.
type UserSettlementReport struct {
	ID           uint64 `gorm:"primaryKey"`
	UserID       uint64
	TeamID       uint64
	CloseBalance int64
	LastUpdated  time.Time
}

func (UserSettlementReport) TableName() string {
	return "user_settlement_reports"
}
