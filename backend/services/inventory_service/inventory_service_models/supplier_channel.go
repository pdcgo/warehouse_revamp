package inventory_service_models

import "time"

// SupplierChannel is a row of `supplier_channels` — one way to reach or order from a supplier (#120):
// an ONLINE channel (a store on a marketplace) or an OFFLINE channel (a physical shop). Schema owned
// by goose (db_migrations); GORM only reads and writes rows (no AutoMigrate).
//
// supplier_id is a REAL FK to `suppliers` (same service), ON DELETE CASCADE. `type` and `marketplace`
// are stored as TEXT and mapped in the handler layer (no DB CHECK IN-list, cf. #80). For an offline
// channel `marketplace`/`url` are empty; for an online channel `contact`/`location` are optional.
type SupplierChannel struct {
	ID          uint64 `gorm:"primaryKey"`
	SupplierID  uint64
	Type        string
	Marketplace string
	Name        string
	URL         string
	Contact     string
	Location    string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (SupplierChannel) TableName() string {
	return "supplier_channels"
}
