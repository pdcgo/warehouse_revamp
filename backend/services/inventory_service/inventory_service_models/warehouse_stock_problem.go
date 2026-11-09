package inventory_service_models

import "time"

// WarehouseStockProblem is a row of `warehouse_stock_problems` — units of ONE batch broken or lost in the warehouse's
// custody, at that batch's price (a-loss-in-custody-is-a-stock-problem, a-shortage-writes-a-row-per-batch). Lost is
// claimable for all its units, broken for none (a-broken-unit-is-thrown-away); a claim never passes what is claimable
// (a-claim-records-its-units).
type WarehouseStockProblem struct {
	ID            uint64 `gorm:"primaryKey"`
	WarehouseID   uint64
	TeamID        uint64
	ProductID     uint64
	TransactionID uint64
	BatchID       uint64
	// Set when every unit came from one rack (a-problem-row-names-its-rack).
	PlacementID         *uint64
	Note                string
	ProblemType         ProblemType
	ProblemStockCount   int64
	PriceUnit           float64
	ClaimableStockCount int64
	ClaimedStockCount   int64
	CreatedAt           time.Time
}

func (WarehouseStockProblem) TableName() string {
	return "warehouse_stock_problems"
}
