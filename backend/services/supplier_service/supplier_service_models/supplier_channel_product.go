package supplier_service_models

import "time"

// SupplierChannelProduct is a row of `supplier_channel_products` (00005) — one of a supplier's products, per store it
// was bought from (products-hang-off-a-channel), or under the supplier with no store when the line named none
// (a-line-with-no-store-links-under-the-supplier). Written only by the RestockAccepted fold and
// `san supplier backfill-links`; schema owned by goose, GORM only reads rows.
//
// ChannelID nil = no store. FirstRestockedAt / LastRestockedAt are the earliest and latest accepts that named the link
// (a-link-remembers-its-last-restock); LastRestockID is the restock of the latest.
type SupplierChannelProduct struct {
	ID               uint64 `gorm:"primaryKey"`
	TeamID           uint64
	SupplierID       uint64
	ChannelID        *uint64
	ProductID        uint64
	FirstRestockedAt time.Time
	LastRestockedAt  time.Time
	LastRestockID    uint64
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (SupplierChannelProduct) TableName() string {
	return "supplier_channel_products"
}
