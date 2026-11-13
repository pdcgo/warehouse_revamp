package inventory_service_models

import "time"

// WarehouseTransferCountCorrection is a row of `warehouse_transfer_count_corrections` (00043) — ONE batch piece of a
// transfer line whose arrived count warehouse B corrected. A line drawing several of B's batches (one per source layer)
// writes one row per batch moved: FromCount / ToCount are the line's, UnitsOut the piece's. LayerBatchID is the source
// batch at A the piece's batch at B stands for.
type WarehouseTransferCountCorrection struct {
	ID             uint64 `gorm:"primaryKey"`
	TransferID     uint64
	TransferItemID uint64
	ProductID      uint64
	WarehouseID    uint64
	TeamID         uint64
	TransactionID  uint64
	BatchID        uint64
	LayerBatchID   uint64
	PlacementID    uint64
	FromCount      int64
	ToCount        int64
	UnitsOut       int64
	PriceUnit      float64
	Total          float64
	Reason         string
	ActorUserID    uint64
	IsOverride     bool
	CreatedAt      time.Time
}

func (WarehouseTransferCountCorrection) TableName() string {
	return "warehouse_transfer_count_corrections"
}
