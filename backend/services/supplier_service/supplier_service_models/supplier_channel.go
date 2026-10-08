package supplier_service_models

import "time"

// SupplierChannel is a row of `supplier_channels` — one online store a supplier sells through. Schema owned
// by goose (db_migrations); GORM only reads and writes rows (no AutoMigrate).
//
// ChannelType is the shared marketplace code (san_marketplace.ToText) — `other` is the owner's `custom`.
// Delete is soft, as on Supplier, and for the same reason: a restock line names its store.
type SupplierChannel struct {
	ID          uint64 `gorm:"primaryKey"`
	SupplierID  uint64
	ChannelType string
	Name        string
	URI         string `gorm:"column:uri"`
	Description string
	DeletedAt   *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (SupplierChannel) TableName() string {
	return "supplier_channels"
}
