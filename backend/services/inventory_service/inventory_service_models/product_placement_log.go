package inventory_service_models

import "time"

// ProductPlacementLog is a row of `product_placement_logs` — append-only, read in id order. StockAfter is the rack's
// count of the product once this row applies.
type ProductPlacementLog struct {
	ID            uint64 `gorm:"primaryKey"`
	WarehouseID   uint64
	TeamID        uint64
	ProductID     uint64
	PlacementID   uint64
	TransactionID uint64
	ChangeType    string
	StockChange   int64
	StockAfter    int64
	Description   string
	ActorID       uint64
	CreatedAt     time.Time
}

func (ProductPlacementLog) TableName() string {
	return "product_placement_logs"
}
