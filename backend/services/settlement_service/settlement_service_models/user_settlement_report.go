package settlement_service_models

import "time"

// UserSettlementReport is a row of `user_settlement_reports` (00005) — a user's LATEST close_balance,
// derived exactly as ShopSettlementReport is.
//
// LastDay (00008) is the newest report day the person has a daily row on, the order SettlementPersonList lists by
// (#the-person-list-reads-the-last-day-from-the-user-report). The fold raises it; a replay and a day re-fold recompute
// it. nil only while the scope has no daily row at all — a replay has cut every one of its days and their redelivery has
// not come back yet, or a re-fold removed its only day.
type UserSettlementReport struct {
	ID           uint64 `gorm:"primaryKey"`
	UserID       uint64
	TeamID       uint64
	CloseBalance float64
	LastDay      *time.Time `gorm:"type:date"`
	LastUpdated  time.Time
}

func (UserSettlementReport) TableName() string {
	return "user_settlement_reports"
}
