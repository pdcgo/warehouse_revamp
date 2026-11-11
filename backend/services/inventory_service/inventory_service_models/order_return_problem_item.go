package inventory_service_models

import "time"

// OrderReturnProblemItem is a row of `order_return_problem_items` — THE RETURN'S DOOR TABLE: one product's broken or
// missing units of a returned parcel, one row per kind, priced from the layers they came off, newest first, at what the
// selling team paid (a-short-return-is-missing-at-the-door, a-broken-returned-unit-is-thrown-away-at-the-door). The
// selling team bears them: a door row never posts to the warehouse's payable, is never claimable by a later surplus,
// and is not in Inventory Lost. Shaped like warehouse_transfer_problem_items, keyed by the return transaction.
type OrderReturnProblemItem struct {
	ID uint64 `gorm:"primaryKey"`
	// The return transaction the row belongs to — one per order's take (order_return_checks).
	TransactionID uint64
	// The product the take drew — the order line's, as the parcel's label names it.
	ProductID   uint64
	ProblemType TransferProblemType
	// The crew's optional note (a-return-door-row-carries-an-optional-note).
	Note      string
	Count     int64
	PriceUnit float64
	Total     float64
	CreatedAt time.Time
}

func (OrderReturnProblemItem) TableName() string {
	return "order_return_problem_items"
}
