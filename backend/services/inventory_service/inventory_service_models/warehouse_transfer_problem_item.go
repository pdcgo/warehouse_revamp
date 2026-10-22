package inventory_service_models

import "time"

// TransferProblemType is what went wrong with units at B's door (broken-and-missing-at-the-door-are-problem-rows).
type TransferProblemType string

const (
	TransferProblemBroken  TransferProblemType = "broken"
	TransferProblemMissing TransferProblemType = "missing"
)

// WarehouseTransferProblemItem is a row of `warehouse_transfer_problem_items` — one product's broken or missing units,
// one row per kind, priced from the layers they came off, newest first (the-system-fills-a-transfers-prices).
type WarehouseTransferProblemItem struct {
	ID          uint64 `gorm:"primaryKey"`
	TransferID  uint64
	ProductID   uint64
	ProblemType TransferProblemType
	Note        string
	Count       int64
	PriceUnit   float64
	Total       float64
	CreatedAt   time.Time
}

func (WarehouseTransferProblemItem) TableName() string {
	return "warehouse_transfer_problem_items"
}
