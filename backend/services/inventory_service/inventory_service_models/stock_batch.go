package inventory_service_models

import "time"

// StockBatch is a row of `stock_batches` (#208/#209) — one product's units from one delivery, and the
// cost layer they carry. A batch is minted when a restock line is accepted (#206/#207): the line IS the
// batch, so `RestockRequestItemID` is unique.
//
// Arrived is fixed at acceptance; Ready = Σ StockShelfBatch.Qty for this batch (derived); Used =
// Arrived − Damaged − Ready. warehouse_id/product_id/delivery_id/created_by/accepted_by are opaque
// cross-service ids; schema owned by goose, GORM only reads/writes rows.
type StockBatch struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	ProductID   uint64
	// The delivery's display number (the restock request id), denormalised so a batch list need not
	// join to name it. The received LINE is the real identity — see RestockRequestItemID.
	DeliveryID           uint64
	RestockRequestItemID uint64

	// ⚠ FROZEN HPP, whole rupiah. nil is UNKNOWN, never 0 (#74) — value math must tolerate nil.
	UnitCost *int64

	ArrivedQty int64
	DamagedQty int64

	// nil = does not expire (perishables only, #208).
	ExpiresOn *time.Time

	// Who raised the restock, who accepted it — opaque user ids, 0 when unknown.
	CreatedBy  uint64
	AcceptedBy uint64

	CreatedAt  time.Time
	AcceptedAt time.Time
}

func (StockBatch) TableName() string {
	return "stock_batches"
}

// StockShelfBatch is a row of `stock_shelf_batches` — how many READY units of one batch sit on one
// shelf (#208). This is the (shelf × batch) grain the stock feature turns on; on-hand for a
// (product, rack) is the SUM over the batches on it.
//
// ⚠ RackID is NULLABLE (the unplaced pile, #135) and part of the identity, which GORM's primary-key
// path cannot express against NULL — writes go through raw SQL with `IS NOT DISTINCT FROM` /
// ON CONFLICT against the unique index, never Save()/Updates()-by-PK, exactly as stock_levels does.
type StockShelfBatch struct {
	ID      uint64 `gorm:"primaryKey"`
	BatchID uint64
	// NULL = unplaced/holding (#135).
	RackID    *uint64
	Qty       int64
	UpdatedAt time.Time
}

func (StockShelfBatch) TableName() string {
	return "stock_shelf_batches"
}
