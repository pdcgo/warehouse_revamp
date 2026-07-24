package inventory_v1

import "context"

// ExpensePoster is how inventory_service records the COST of stock it writes off (#211, owner's Q4).
//
// When a warehouse marks a batch's units DAMAGED or LOST, the quantity leaves stock — and the money
// those units were worth (their frozen HPP) is a loss the warehouse bears. Recording only the quantity
// would answer "how many did we lose" but never "what did the losses cost us", which is the question a
// manager chasing a supplier or a shift actually asks.
//
// An INTERFACE THIS SERVICE OWNS, in its own terms, exactly like SettlementPoster — inventory must not
// import expense_service, and the adapter lives in the composition root.
//
// ⚠ UNLIKE SettlementPoster, it does NOT take the caller's transaction, and that is deliberate: the
// loss VALUE is a derived record, not the primary fact. The primary fact — the stock leaving the
// shelf — must commit whether or not the expense write succeeds, so this is posted AFTER the adjust
// transaction commits. A rare dropped expense is a gap a report can find; a stock adjust that failed
// because a downstream ledger was unwired would be inventory refusing to do its own job.
type ExpensePoster interface {
	// PostStockLoss records `amount` rupiah (qty × the batch's frozen unit cost) as an expense the
	// warehouse team bears, with a human note. Called only for a KNOWN cost — an unknown-cost batch has
	// no value to write off (#74).
	PostStockLoss(ctx context.Context, warehouseID uint64, amount int64, note string) error
}

// noExpense is what a Service built without a poster uses: it drops the loss value on the floor. A unit
// test correcting a shelf should not have to construct an expense service, and inventory's own job must
// not fail for a value record. The composition root wires the real one.
type noExpense struct{}

func (noExpense) PostStockLoss(context.Context, uint64, int64, string) error { return nil }
