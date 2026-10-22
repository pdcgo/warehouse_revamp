package inventory_ledgers

import "fmt"

// NotEnoughStockError refuses a take that wants more than the scope holds. It names the product and both numbers, so a
// caller can name every refused line (a-refusal-names-its-reason-and-every-line).
type NotEnoughStockError struct {
	ProductID uint64
	Wanted    int64
	Available int64
	// Where the shortfall is: "batches" or "placements".
	Ledger string
}

func (e *NotEnoughStockError) Error() string {
	return fmt.Sprintf("not enough stock of product %d in %s: wanted %d, available %d", e.ProductID, e.Ledger, e.Wanted, e.Available)
}
