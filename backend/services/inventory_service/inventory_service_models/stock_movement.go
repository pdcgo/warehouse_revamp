package inventory_service_models

import "time"

// StockMovement is a row of `stock_movements` — the APPEND-ONLY ledger, the source of truth. Every
// change to on-hand is one row with a cause (Kind) and a signed Delta; Balance is the on-hand AFTER
// this movement, so history reads as a running total.
//
// Kind is the MovementKind enum's number. warehouse_id/product_id are opaque cross-service ids.
type StockMovement struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	ProductID   uint64
	Delta       int64
	Balance     int64
	Kind        int32
	Reason      string
	Ref         string
	ActorUserID uint64
	CreatedAt   time.Time
}

func (StockMovement) TableName() string {
	return "stock_movements"
}
