package selling_service_models

import "time"

// ShopUser is a row of `shop_users` — a grant that lets one user work on one shop (#86). user_id is
// an OPAQUE user_service id (no FK across the service boundary). Schema owned by goose; GORM only
// reads/writes rows.
type ShopUser struct {
	ID        uint64 `gorm:"primaryKey"`
	ShopID    uint64
	UserID    uint64
	CreatedAt time.Time
}

func (ShopUser) TableName() string {
	return "shop_users"
}
