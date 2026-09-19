package selling_v1_test

import (
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// Test helpers reading the guideline list shapes back into flat slices, in each response's sorted id
// order. The handlers default an empty data_request to the row slice.

func orderRows(res *sellingv1.OrderListResponse) []*sellingv1.Order {
	var m map[uint64]*sellingv1.Order
	for _, it := range res.GetItems() {
		o := it.GetOrder()
		if o != nil {
			m = o.GetMapData()
		}
	}

	out := make([]*sellingv1.Order, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}

func draftRows(res *sellingv1.OrderDraftListResponse) []*sellingv1.OrderDraft {
	var m map[uint64]*sellingv1.OrderDraft
	for _, it := range res.GetItems() {
		d := it.GetOrderDraft()
		if d != nil {
			m = d.GetMapData()
		}
	}

	out := make([]*sellingv1.OrderDraft, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}

func shopRows(res *sellingv1.ShopListResponse) []*sellingv1.Shop {
	var m map[uint64]*sellingv1.Shop
	for _, it := range res.GetItems() {
		sh := it.GetShop()
		if sh != nil {
			m = sh.GetMapData()
		}
	}

	out := make([]*sellingv1.Shop, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}
