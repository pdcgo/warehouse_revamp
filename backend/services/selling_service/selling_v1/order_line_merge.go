package selling_v1

import (
	"errors"
	"fmt"
	"math"

	"google.golang.org/protobuf/proto"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// errOrderLinesDisagree is two lines of ONE product that do not say the same thing about it. Merging them would keep
// one of the two labels and silently drop the other, so the order is refused instead — see mergeOrderLines.
var errOrderLinesDisagree = errors.New("the same product is on two lines that disagree")

// errOrderLineTooMany is a product whose lines add up to more units than one order line can hold (uint32).
var errOrderLineTooMany = errors.New("a product's lines add up to more units than one order line can hold")

// mergeOrderLines folds every line naming the same product into ONE line, its quantities summed, in the order each
// product first appears.
//
// WHY. A request may name a product twice — the order form adds a bundle's products as ordinary lines, so the same
// product can arrive once by hand and once from a bundle, and a draft's two scraped rows can map to one product. But
// the order keeps only product lines (the-order-keeps-only-product-lines), the take draws a product ONCE per order and
// refuses one listed twice, and every money figure of a line is that one draw
// (an-order-is-costed-at-what-leaves-the-shelf). So one product is one line, on every door, decided HERE rather than in
// each client — a future client that forgets to merge is covered too.
//
// NO PRICE IS COMPARED. A line carries no price of its own (an-order-line-carries-no-marketplace-price): its money is
// the take's, stamped by placeOrder after the merge — so two draft rows of one product at two marketplace prices merge
// into one line and lose nothing. The prices stay on the draft's rows.
//
// ⚠ THE LABEL IS. Two lines of one product must agree on its sku and its name, which are stored as given on
// OrderCreate. The form always sends them equal (the catalogue's label, per product) and Promote reads one snapshot per
// product, so only a client sending one product under two labels meets this — and folding them would keep one label
// and drop the other. That is refused, naming the product.
//
// The input is never modified: each merged line is a copy, so the caller's request reads as it arrived.
func mergeOrderLines(items []*sellingv1.OrderItem) ([]*sellingv1.OrderItem, error) {
	merged := make([]*sellingv1.OrderItem, 0, len(items))
	at := make(map[uint64]int, len(items))

	for _, item := range items {
		i, seen := at[item.GetProductId()]
		if !seen {
			at[item.GetProductId()] = len(merged)

			line, _ := proto.Clone(item).(*sellingv1.OrderItem)
			merged = append(merged, line)

			continue
		}

		line := merged[i]

		disagreement := lineDisagreement(line, item)
		if disagreement != "" {
			return nil, fmt.Errorf("%w — product %d: %s; an order keeps one line per product, so they must agree",
				errOrderLinesDisagree, item.GetProductId(), disagreement)
		}

		quantity := uint64(line.GetQuantity()) + uint64(item.GetQuantity())
		if quantity > math.MaxUint32 {
			return nil, fmt.Errorf("%w — product %d", errOrderLineTooMany, item.GetProductId())
		}

		line.Quantity = uint32(quantity)
	}

	return merged, nil
}

// lineDisagreement names what two lines of one product say differently, or "" when they agree on everything but
// their quantity. Only the label is compared: `id` is ignored on input, and every money field is the warehouse's,
// never the request's (#74, an-order-line-carries-no-marketplace-price).
func lineDisagreement(a, b *sellingv1.OrderItem) string {
	switch {
	case a.GetSku() != b.GetSku():
		return fmt.Sprintf("sku %q on one line, %q on the other", a.GetSku(), b.GetSku())
	case a.GetName() != b.GetName():
		return fmt.Sprintf("name %q on one line, %q on the other", a.GetName(), b.GetName())
	}

	return ""
}
