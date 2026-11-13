package inventory_service_models

import "time"

// The two log change types a received-count correction writes (00043) — its `adjustment` transaction's batch and rack
// rows. Never `adjustment` itself: on a rack row that means "last counted". The history reads both as ADJUST; the
// Restock and Transfer metrics read them beside `restock` / `transfer_in`, on the correction's own day
// (a-received-count-correction-counts-on-its-own-day).
const (
	ChangeRestockCorrection  = "restock_correction"
	ChangeTransferCorrection = "transfer_correction"
)

// RestockCountCorrection is a row of `restock_count_corrections` (00043) — ONE line of a restock whose received count the
// receiving warehouse corrected (KOREKSI JUMLAH TERIMA, the-warehouse-corrects-a-wrong-stock-in-alone). Append-only: the
// line's Kurang is the accept's missing row plus Σ UnitsOut.
type RestockCountCorrection struct {
	ID            uint64 `gorm:"primaryKey"`
	RestockID     uint64
	RestockItemID uint64
	ProductID     uint64
	WarehouseID   uint64
	// The selling team that owns the goods.
	TeamID        uint64
	TransactionID uint64
	BatchID       uint64
	PlacementID   uint64
	FromCount     int64
	ToCount       int64
	// FromCount − ToCount: > 0 units out of the batch (missing, koreksi), < 0 units into it.
	UnitsOut  int64
	PriceUnit float64
	// Signed like UnitsOut — what the selling team bears (a-stock-in-correction-keeps-the-batch-price).
	Total       float64
	Reason      string
	ActorUserID uint64
	IsOverride  bool
	CreatedAt   time.Time
}

func (RestockCountCorrection) TableName() string {
	return "restock_count_corrections"
}
