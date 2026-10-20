package inventory_service_models

import "time"

// WarehouseTransferItem is a row of `warehouse_transfer_items` — one product of a transfer
// (a-product-appears-once-per-transfer), never edited after create. Total is what the out-leg took; PriceUnit is
// Total ÷ Count, for display only (the-system-fills-a-transfers-prices).
type WarehouseTransferItem struct {
	ID         uint64 `gorm:"primaryKey"`
	TransferID uint64
	ProductID  uint64
	// The product's sku and name at create.
	SKU       string `gorm:"column:sku"`
	Name      string
	Count     int64
	PriceUnit float64
	Total     float64
	// In the box at B, broken included; 0 until accepted.
	ArrivedCount int64
	CreatedAt    time.Time
}

func (WarehouseTransferItem) TableName() string {
	return "warehouse_transfer_items"
}
