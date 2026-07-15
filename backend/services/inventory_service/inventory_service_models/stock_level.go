package inventory_service_models

import "time"

// StockLevel is a row of `stock_levels` — the DERIVED on-hand of a product at a warehouse. It is a
// cache of SUM(delta) over the ledger, maintained inside each movement's transaction; a CHECK keeps
// on_hand >= 0. Schema owned by goose (db_migrations); GORM only reads/writes rows (no AutoMigrate).
//
// warehouse_id and product_id are OPAQUE cross-service ids (team_service / product_service) — no FK.
type StockLevel struct {
	WarehouseID uint64 `gorm:"primaryKey"`
	ProductID   uint64 `gorm:"primaryKey"`
	OnHand      int64
	UpdatedAt   time.Time
}

func (StockLevel) TableName() string {
	return "stock_levels"
}
