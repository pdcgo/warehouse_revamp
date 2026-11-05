package inventory_service_models

import "time"

// InventoryLostDailyReport is a row of `inventory_lost_daily_reports` — the units LOST in one warehouse's custody on one
// Jakarta day, of one owner's product from one supplier, and their value at the batch's price
// (inventory-lost-counts-the-warehouses-custody-losses). Folded in the problem row's own transaction
// (inventory_mutations.foldLost); gross — never lowered (inventory-lost-is-gross).
type InventoryLostDailyReport struct {
	ID          uint64 `gorm:"primaryKey"`
	Day         time.Time
	WarehouseID uint64
	TeamID      uint64
	ProductID   uint64
	SupplierID  uint64
	LostCount   int64
	LostAmount  float64 `gorm:"type:numeric(20,2)"`
	LastUpdated time.Time
}

func (InventoryLostDailyReport) TableName() string {
	return "inventory_lost_daily_reports"
}
