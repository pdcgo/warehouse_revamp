package inventory_service_models

import "time"

// Batch is a row of `batches` — the batch ledger's state, one batch per scope. StockValuation is the truth: a batch at
// 0 units is worth exactly 0 (an-emptying-take-takes-all-the-value). TeamID is the owner, written at mint and never
// changed (a-batch-carries-its-owner). A batch is never deleted.
type Batch struct {
	ID                 uint64 `gorm:"primaryKey"`
	WarehouseID        uint64
	TeamID             uint64
	ProductID          uint64
	TransactionID      uint64
	PriceUnit          float64
	StockCount         int64
	StockValuation     float64
	InitStockCount     int64
	InitStockValuation float64
	// Copied from the restock line or the source batch (a-batch-keeps-its-supplier). 0 = not named.
	SupplierID        uint64
	SupplierChannelID uint64
	// Read by the expiry report only, never by the take (expiry-is-a-report).
	ExpiredAt *time.Time
	UpdatedAt time.Time
	CreatedAt time.Time
}

func (Batch) TableName() string {
	return "batches"
}
