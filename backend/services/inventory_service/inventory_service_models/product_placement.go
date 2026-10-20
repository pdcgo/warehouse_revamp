package inventory_service_models

import "time"

// ProductPlacement is a row of `product_placements` — the placement ledger's state, one row per product per rack
// (one-shelf-row-per-product-per-placement). StockCount never goes below zero, checked by the database
// (a-shelf-never-goes-below-zero). It never knows a batch (expiry-is-a-report). PlacementID points at `racks` until
// stage 3 renames it `placements`.
type ProductPlacement struct {
	ID          uint64 `gorm:"primaryKey"`
	TeamID      uint64
	WarehouseID uint64
	ProductID   uint64
	PlacementID uint64
	StockCount  int64
	UpdatedAt   time.Time
	CreatedAt   time.Time
}

func (ProductPlacement) TableName() string {
	return "product_placements"
}
