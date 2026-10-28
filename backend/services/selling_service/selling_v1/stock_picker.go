package selling_v1

import (
	"context"
	"strconv"

	"connectrpc.com/connect"

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
	// `ref` is written onto every movement, and is what Return later names to undo exactly this pick.
	//
	// It answers WHAT EACH LINE DREW, by product: the cost of the units that left the shelf, and the line's total — that
	// cost plus, on another team's product, the product's own cross markup — computed by the warehouse, never here
	// (inventory-computes-the-markup, an-order-is-costed-at-what-leaves-the-shelf). The order freezes every money figure
	// of the line and its header from this one answer (a-lines-money-is-frozen-at-finalize). A product absent from the
	// map was priced at nothing the warehouse could say: its line freezes no cost and no total.
	Pick(ctx context.Context, sellingTeamID, warehouseID uint64, lines []PickLine, ref string) (PickDraw, error)

	// Return puts a pick back, naming the `ref` it was taken under. The stock goes back exactly where
	// it came from, including the split across shelves — the inventory side reverses the movements it
	// recorded rather than trusting quantities from here.
	//
	// Returning a ref twice is refused there, which is what makes a retry safe from here.
	Return(ctx context.Context, sellingTeamID, warehouseID uint64, ref string) error

	// ⚠ There is no cost read beside Pick any more. An order is costed at the units that leave the shelf
	// (an-order-is-costed-at-what-leaves-the-shelf), which only the take knows — the shelf's average, read before it,
	// was a different figure and is never an order's cost.
}

// isNothingToReturn reports whether a Return failed because there was nothing to give back.
//
// That is not an error from the caller's side (#70): an order placed before #149 never drew stock, so
// cancelling it has nothing to undo, and refusing to cancel those would be punishing history. Every
// other failure is real and must not be swallowed with it.
//
// It reads the Connect CODE rather than matching the message, so a reworded error on the inventory
// side cannot silently turn "nothing to return" into "we swallowed a genuine failure".
func isNothingToReturn(err error) bool {
	return connect.CodeOf(err) == connect.CodeNotFound
}

// stockRef is the reference an order's stock draw is recorded under (#149/#70).
//
// It is derived from the order id rather than being a separate token, so the ledger traces straight
// back to the order without another column to keep in sync — and a cancel can name the draw to undo
// knowing only the order it is cancelling.
//
// The prefix matters: `ref` is a free-text column shared with every other movement kind (a restock
// fulfil writes a shipping code there), so an un-prefixed "42" could collide with something that is
// not an order at all.
func stockRef(orderID uint64) string {
	return "order:" + strconv.FormatUint(orderID, 10)
}

// pickLines turns an order's lines into the picker's terms. Deliberately a translation rather than a
// shared type: selling_service's idea of a line carries money and a sku snapshot, and inventory has no
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
