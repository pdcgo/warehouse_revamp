package inventory_service_models

import "time"

// StockMovement is a row of `stock_movements` — the APPEND-ONLY ledger, the source of truth. Every
// change to on-hand is one row with a cause (Kind) and a signed Delta; Balance is the on-hand AFTER
// this movement, so history reads as a running total.
//
// Kind is the MovementKind enum's number. warehouse_id/product_id are opaque cross-service ids;
// rack_id is a real FK (racks live in this same service).
type StockMovement struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	ProductID   uint64

	// The PLACE this movement moved stock onto or off (#135). nil = unplaced — either stock that
	// arrived before anyone shelved it, or every movement written before racks carried stock at all.
	RackID *uint64

	// WHICH BATCH this event moved (#208). nil for a batch-less event — a shelf RECOUNT reconciles the
	// whole shelf and shows Batch "—" (#211), even though its delta lands on the oldest batch (FIFO).
	// Every batch-scoped event (receive/move/pick/adjust) carries it. Real FK: batches live here.
	BatchID *uint64

	Delta int64
	// The on-hand of THIS PLACE after the movement, not the warehouse's total for the product. Once a
	// product can sit on several racks those are different numbers, and a ledger row is a statement
	// about one place: "this shelf went from 40 to 49". The warehouse total is a SUM across places.
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
