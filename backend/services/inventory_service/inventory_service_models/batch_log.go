package inventory_service_models

import "time"

// BatchLog is a row of `batch_logs` — append-only (ledger-logs-are-append-only), read in id order. ChangeType is the
// transaction's type, or a problem's reason (broken, lost). The *After columns are the batch once this row applies.
type BatchLog struct {
	ID                  uint64 `gorm:"primaryKey"`
	WarehouseID         uint64
	TeamID              uint64
	BatchID             uint64
	TransactionID       uint64
	ChangeType          string
	ChangeCount         int64
	ChangeValuation     float64
	StockCountAfter     int64
	StockValuationAfter float64
	PriceUnitAfter      float64
	Description         string
	ActorID             uint64
	CreatedAt           time.Time
}

func (BatchLog) TableName() string {
	return "batch_logs"
}
