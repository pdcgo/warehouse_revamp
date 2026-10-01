package financial_account_service_models

import "time"

// OperationalAccount is a row of `operational_accounts` — an account marked as one that pays for
// operations (operational-accounts-pay-for-operations).
type OperationalAccount struct {
	ID        uint64 `gorm:"primaryKey"`
	TeamID    uint64
	AccountID uint64
	UpdatedAt time.Time
	CreatedAt time.Time
}

func (OperationalAccount) TableName() string {
	return "operational_accounts"
}
