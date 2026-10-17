package inventory_service_models

import "time"

// BatchPriceLog is a row of `batch_price_logs` — every price a batch has had. A mint writes the first (its delta is
// the whole price), a revaluation each change. Append-only.
type BatchPriceLog struct {
	ID             uint64 `gorm:"primaryKey"`
	BatchID        uint64
	NewPriceUnit   float64
	DeltaPriceUnit float64
	Description    string
	ActorID        uint64
	CreatedAt      time.Time
}

func (BatchPriceLog) TableName() string {
	return "batch_price_logs"
}
