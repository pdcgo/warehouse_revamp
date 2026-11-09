package selling_v1

import (
	"context"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// PickLine is one product an order takes out of a warehouse.
type PickLine struct {
	ProductID uint64
	Quantity  int64
}

// PickedLine is what the take drew for one product, and what it priced the line at — rupiah (rupiah-is-floating-point).
type PickedLine struct {
	// The value of the units the take drew: the owner's batches, oldest first (an-order-is-costed-at-what-leaves-the-shelf).
	// What the line COST before any markup — what the line's unit_cost is divided from.
	Cost float64
	// Cost ÷ quantity: what one unit of this draw cost. Not the shelf's average — the units that left.
	UnitCost float64
	// The cost plus, on another team's product, that product's own cross markup (inventory-computes-the-markup) — the
	// line's frozen total, what the product fee is posted from (the-ledger-charges-the-frozen-line-total), and what the
	// order's goods_cost — the warehouse fee's basis — is summed from (the-fee-is-priced-on-goods-cost).
	Total float64
	// Total ÷ quantity: one unit at the owner's markup — the owner's `unit_cost_with_markup`. On an own line, UnitCost.
	UnitCostWithMarkup float64
	// Total − Cost: what the markup added — the owner's `markup_total`. 0 on an own line, never negative.
	MarkupTotal float64
}

// PickDraw is what a pick drew and priced, keyed by product.
//
// Keyed by PRODUCT rather than by line, because that is the take's own grain: it refuses a product listed twice, and
// placeOrder merges a product named on two lines into one before it asks (mergeOrderLines) — so a product's draw is
// exactly one line's.
type PickDraw map[uint64]PickedLine

// Take is the stock take's whole answer: the inventory transaction it wrote — stored on the order as
// `transaction_id` (the-placement-page-reads-racks-by-transaction-id) — and what each line drew.
type Take struct {
	TransactionID uint64
	Draw          PickDraw
}

// StockPicker is how selling_service moves stock when an order is placed or cancelled (#149/#70).
//
// It is an INTERFACE THIS SERVICE OWNS, expressed in this service's own types, and that is deliberate:
// selling_service must never import inventory_service's models or touch its tables (HARD RULE 3). The
// implementation lives in the composition root, where knowing about both services is the entire job —
// so the dependency arrow points at an interface declared here, never at another service's package.
//
// It also makes the failure paths testable. A fake that refuses proves "no stock, no order" without
// seeding a warehouse, and a fake that counts calls proves a failed order write actually compensates.
type StockPicker interface {
	// Pick takes `lines` out of `warehouseID` on behalf of `sellingTeamID`. If it returns an error,
	// NOTHING was taken — the pick is one transaction on the inventory side, across all lines. `lines`
	// names each product once.
	//
	// A REFUSAL comes back as the take's own Connect error — its code and its OrderTransactionRefusal
	// detail — and placeOrder hands it to the caller unchanged (takeError), so it must not be reshaped here.
	//
	// `key` is the ORDER'S OWN IDEMPOTENCY KEY K (the-frontend-mints-the-idempotency-key): the take is filed under it,
	// once — a key already used is refused AlreadyExists with the KEY_USED detail — and Return names it to undo exactly
	// this pick (every-release-goes-by-the-key). The take runs BEFORE the order row exists, so K is all it can be named by.
	//
	// It answers WHAT EACH LINE DREW, by product: the cost of the units that left the shelf, and the line's total — that
	// cost plus, on another team's product, the product's own cross markup — computed by the warehouse, never here
	// (inventory-computes-the-markup, an-order-is-costed-at-what-leaves-the-shelf). The order freezes every money figure
	// of the line and its header from this one answer (a-lines-money-is-frozen-at-finalize). A product absent from the
	// map was priced at nothing the warehouse could say: its line freezes no cost and no total.
	Pick(ctx context.Context, sellingTeamID, warehouseID uint64, lines []PickLine, key string) (Take, error)

	// Return releases the take filed under `key` — the one release by key (every-release-goes-by-the-key). The stock goes
	// back exactly where it came from, including the split across shelves — the inventory side reverses the movements it
	// recorded rather than trusting quantities from here.
	//
	// ONLY THE COMPENSATION OF A FAILED CREATE calls it (the-release-is-direct-then-the-event). A cancelled order's stock
	// goes back on OrderCancelled, released by inventory itself (inventory-returns-stock-on-order-cancelled), so the
	// cancel never calls this.
	//
	// Releasing a key twice gives nothing back the second time, and releasing a key nothing was taken under yet claims it
	// so a late take is refused — which is what makes the compensation's direct call and its InventoryTxCancel backup
	// safe together. Another team's key answers NotFound; a rack a stock count holds answers FailedPrecondition.
	Return(ctx context.Context, sellingTeamID, warehouseID uint64, key string) error

	// StockLockCheck is the count that holds a rack the take under `key` came from, or nil when none does — a READ, in
	// process, that moves nothing (a-cancel-still-meets-the-count-first). OrderCancel asks it FIRST, before the order's
	// status moves, so a cancel a count would block is refused naming the count and the order stays pending.
	//
	// It is a courtesy, not the lock: a count that starts after this answered still stops the release inventory makes on
	// OrderCancelled, which then waits (redelivered) until the count ends. A key with no take of this team answers nil.
	StockLockCheck(ctx context.Context, sellingTeamID, warehouseID uint64, key string) (*StockLock, error)

	// ⚠ There is no cost read beside Pick any more. An order is costed at the units that leave the shelf
	// (an-order-is-costed-at-what-leaves-the-shelf), which only the take knows — the shelf's average, read before it,
	// was a different figure and is never an order's cost.
}

// StockLock is a stock count holding a rack an order's take came from: the count's session, and the warehouse's own
// sentence naming it — the count, who started it and when — which the refused cancel hands to the person as it came.
type StockLock struct {
	SessionID uint64
	Reason    string
}

// pickLines turns an order's lines into the picker's terms. Deliberately a translation rather than a
// shared type: selling_service's idea of a line carries money and a product code snapshot, and inventory has no
// business with either — it needs to know what to take and how much.
func pickLines(items []*sellingv1.OrderItem) []PickLine {
	out := make([]PickLine, 0, len(items))
	for _, item := range items {
		out = append(out, PickLine{
			ProductID: item.GetProductId(),
			// An order line's quantity is uint32; stock counts are int64. Widening, never narrowing,
			// so there is nothing to lose here.
			Quantity: int64(item.GetQuantity()),
		})
	}

	return out
}

// orderProductIDs is the DEDUPLICATED set of products an order touches, which is what an owner lookup
// wants: the contract caps the id list and requires it unique. placeOrder merges a product named on two
// lines before anything reads this (mergeOrderLines), so on that path the dedup is a guard, not a fold.
func orderProductIDs(items []*sellingv1.OrderItem) []uint64 {
	seen := make(map[uint64]struct{}, len(items))
	out := make([]uint64, 0, len(items))

	for _, item := range items {
		id := item.GetProductId()
		if _, dup := seen[id]; dup {
			continue
		}

		seen[id] = struct{}{}
		out = append(out, id)
	}

	return out
}
