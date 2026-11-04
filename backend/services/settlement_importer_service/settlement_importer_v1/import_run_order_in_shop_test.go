package settlement_importer_v1

import (
	"slices"
	"testing"
)

// orderInShop, every case of two-live-orders-on-a-ref-post-to-the-shop: exactly one live order is the line's, a
// cancelled one never beats it, none live falls back to the newest cancelled (as built), and two or more live orders
// pick NONE — the line posts to the shop, naming them ascending. Another shop's orders never count.
func TestOrderInShop(t *testing.T) {
	const shop, other = 10, 20

	for _, tc := range []struct {
		name   string
		orders []OrderRef
		want   uint64
		live   []uint64
		ok     bool
	}{
		{"no order", nil, 0, nil, false},
		{"one live", []OrderRef{{OrderID: 5, ShopID: shop}}, 5, []uint64{5}, true},
		{"a live one beats a newer cancelled one", []OrderRef{
			{OrderID: 5, ShopID: shop},
			{OrderID: 9, ShopID: shop, Cancelled: true},
		}, 5, []uint64{5}, true},
		{"a re-entry beats the order it replaced", []OrderRef{
			{OrderID: 5, ShopID: shop, Cancelled: true},
			{OrderID: 9, ShopID: shop},
		}, 9, []uint64{9}, true},
		{"none live — the newest cancelled, as built", []OrderRef{
			{OrderID: 9, ShopID: shop, Cancelled: true},
			{OrderID: 5, ShopID: shop, Cancelled: true},
		}, 9, nil, true},
		{"two live — none, both named ascending", []OrderRef{
			{OrderID: 9002, ShopID: shop},
			{OrderID: 9001, ShopID: shop},
		}, 0, []uint64{9001, 9002}, false},
		{"three live and a cancelled — none, the live named", []OrderRef{
			{OrderID: 7, ShopID: shop},
			{OrderID: 3, ShopID: shop, Cancelled: true},
			{OrderID: 4, ShopID: shop},
			{OrderID: 6, ShopID: shop},
		}, 0, []uint64{4, 6, 7}, false},
		{"another shop's live order is not a second one", []OrderRef{
			{OrderID: 5, ShopID: shop},
			{OrderID: 8, ShopID: other},
		}, 5, []uint64{5}, true},
		{"only another shop's", []OrderRef{{OrderID: 8, ShopID: other}}, 0, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			order, live, ok := orderInShop(tc.orders, shop)

			if ok != tc.ok || order.OrderID != tc.want || !slices.Equal(live, tc.live) {
				t.Fatalf("orderInShop = (%d, %v, %v), want (%d, %v, %v)", order.OrderID, live, ok, tc.want, tc.live, tc.ok)
			}
		})
	}
}

// found_order_ids round-trips: written ascending, read back the same; empty is none.
func TestFoundOrderIDs(t *testing.T) {
	text := joinIDs([]uint64{9002, 9001, 17})
	if text != "17,9001,9002" {
		t.Fatalf("joinIDs = %q", text)
	}

	if got := parseIDs(text); !slices.Equal(got, []uint64{17, 9001, 9002}) {
		t.Fatalf("parseIDs = %v", got)
	}

	if parseIDs("") != nil || joinIDs(nil) != "" {
		t.Fatal("no ids must be '' and nil")
	}
}
