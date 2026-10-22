package inventory_service_models

import "time"

// InventoryTransactionItem is a row of `inventory_transaction_items` — a transaction's summary, one per product
// (an-item-names-its-product). It equals its batch rows (an-item-equals-its-batch-rows) and is read, never reversed:
// history, the order's line cost, the sample list, shared-product info and reports read it
// (items-are-what-history-and-reports-read).
type InventoryTransactionItem struct {
	ID            uint64 `gorm:"primaryKey"`
	WarehouseID   uint64
	TransactionID uint64
	ProductID     uint64
	// The product's owner (an-item-carries-its-owning-team); IsOwned = the owner is the transaction's team.
	ProductTeamID uint64
	IsOwned       bool
	// Always positive: the transaction's type gives the direction.
	Quantity  int64
	Total     float64
	CreatedAt time.Time
}

func (InventoryTransactionItem) TableName() string {
	return "inventory_transaction_items"
}
