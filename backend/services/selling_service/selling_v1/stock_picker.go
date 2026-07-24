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
	// NOTHING was taken — the pick is one transaction on the inventory side, across all lines.
	//
	// `ref` is written onto every movement, and is what Return later names to undo exactly this pick.
	Pick(ctx context.Context, sellingTeamID, warehouseID uint64, lines []PickLine, ref string) error

	// Return puts a pick back, naming the `ref` it was taken under. The stock goes back exactly where
	// it came from, including the split across shelves — the inventory side reverses the movements it
	// recorded rather than trusting quantities from here.
	//
	// Returning a ref twice is refused there, which is what makes a retry safe from here.
	Return(ctx context.Context, sellingTeamID, warehouseID uint64, ref string) error

	// UnitCosts reports what each product COST the warehouse, so an order can freeze its COGS (#74).
	//
	// A product with NO known cost is absent from the map rather than present as 0 — "we do not know
	// what this cost" and "this cost nothing" are different facts, and collapsing them would let an
	// order book a margin as if the goods were free.
	UnitCosts(ctx context.Context, sellingTeamID, warehouseID uint64, productIDs []uint64) (map[uint64]int64, error)
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

// orderProductIDs is the DEDUPLICATED set of products an order touches, which is what a cost lookup
// wants: the contract caps the id list and requires it unique, and an order may legitimately name the
// same product on two lines.
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
