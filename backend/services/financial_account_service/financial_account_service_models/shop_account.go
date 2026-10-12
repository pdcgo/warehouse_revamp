package financial_account_service_models

import "time"

// ShopAccount is a row of `shop_accounts` — the account a shop withdraws into
// (a-shop-names-the-account-it-withdraws-into). One per shop (a-shop-has-one-account).
type ShopAccount struct {
	ID        uint64 `gorm:"primaryKey"`
	TeamID    uint64
	ShopID    uint64
	AccountID uint64
	UpdatedAt time.Time
	CreatedAt time.Time
}

func (ShopAccount) TableName() string {
	return "shop_accounts"
}
