package inventory_service_models

import "time"

// StockOwnerMovement is a row of `stock_owner_movements` — the CATALOGUE OWNER's ledger (#232), the
// same events as StockMovement seen by the team that owns the goods rather than by the shelf.
//
// It carries no balance. The owner's on-hand after each event is a running sum over these rows,
// computed at read time — see the migration for why storing it would be a number two writers race on.
//
// A shelf-to-shelf MOVE is never projected: it changes where a building's stock sits, not what the
// owner holds. warehouse_id/product_id are opaque cross-service ids; batch_id is a real FK.
type StockOwnerMovement struct {
	ID         uint64 `gorm:"primaryKey"`
	MovementID uint64

	// The owning team, derived from the restock the stock arrived on — never supplied by a caller.
	OwnerTeamID uint64

	WarehouseID uint64
	ProductID   uint64

	// nil for a batch-less event (a shelf recount), which resolves its owner from the product instead.
	BatchID *uint64

	Delta int64
	Kind  int32

	Reason      string
	Ref         string
	ActorUserID uint64

	// The EVENT's time, copied from the movement — not this row's insert time.
	CreatedAt time.Time
}

func (StockOwnerMovement) TableName() string {
	return "stock_owner_movements"
}
