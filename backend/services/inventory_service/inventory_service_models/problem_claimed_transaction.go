package inventory_service_models

import "time"

// ProblemClaimedTransaction is a row of `problem_claimed_transactions` — a found unit claiming a loss back: which
// problem, which transaction, how many units (a-claim-names-its-transaction, a-claim-records-its-units).
type ProblemClaimedTransaction struct {
	ID                uint64 `gorm:"primaryKey"`
	WarehouseID       uint64
	ProblemID         uint64
	TransactionID     uint64
	ClaimedStockCount int64
	CreatedAt         time.Time
}

func (ProblemClaimedTransaction) TableName() string {
	return "problem_claimed_transactions"
}
