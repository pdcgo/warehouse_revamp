package inventory_v1_test

import (
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// Test helpers reading the guideline list shapes back into flat slices, in each response's sorted id
// order. The handlers default an empty data_request to the row slice.

func supplierRows(res *inventoryv1.SupplierListResponse) []*inventoryv1.Supplier {
	var m map[uint64]*inventoryv1.Supplier
	for _, it := range res.GetItems() {
		s := it.GetSupplier()
		if s != nil {
			m = s.GetMapData()
		}
	}

	out := make([]*inventoryv1.Supplier, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}

func requestRows(res *inventoryv1.RestockRequestListResponse) []*inventoryv1.RestockRequest {
	var m map[uint64]*inventoryv1.RestockRequest
	for _, it := range res.GetItems() {
		r := it.GetRestockRequest()
		if r != nil {
			m = r.GetMapData()
		}
	}

	out := make([]*inventoryv1.RestockRequest, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}

func channelRows(res *inventoryv1.SupplierChannelListResponse) []*inventoryv1.SupplierChannel {
	var m map[uint64]*inventoryv1.SupplierChannel
	for _, it := range res.GetItems() {
		c := it.GetSupplierChannel()
		if c != nil {
			m = c.GetMapData()
		}
	}

	out := make([]*inventoryv1.SupplierChannel, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}
