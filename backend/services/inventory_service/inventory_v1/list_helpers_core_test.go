package inventory_v1_test

import (
	"sort"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// Readers for the inventory.proto core guideline shapes.

func stockLevelRows(res *inventoryv1.StockListResponse) []*inventoryv1.StockLevel {
	var m map[uint64]*inventoryv1.StockLevel
	for _, it := range res.GetItems() {
		if s := it.GetStock(); s != nil {
			m = s.GetMapData()
		}
	}
	out := make([]*inventoryv1.StockLevel, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		if r, ok := m[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

func stockHistoryRows(res *inventoryv1.StockHistoryResponse) []*inventoryv1.StockMovement {
	var m map[uint64]*inventoryv1.StockMovement
	for _, it := range res.GetItems() {
		if mv := it.GetMovement(); mv != nil {
			m = mv.GetMapData()
		}
	}
	out := make([]*inventoryv1.StockMovement, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		if r, ok := m[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

func batchRows(res *inventoryv1.BatchListResponse) []*inventoryv1.StockBatch {
	var m map[uint64]*inventoryv1.StockBatch
	for _, it := range res.GetItems() {
		if b := it.GetBatch(); b != nil {
			m = b.GetMapData()
		}
	}
	out := make([]*inventoryv1.StockBatch, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		if r, ok := m[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

func batchShelfRows(res *inventoryv1.BatchPlacementListResponse) []*inventoryv1.BatchShelf {
	var m map[uint64]*inventoryv1.BatchShelf
	for _, it := range res.GetItems() {
		if s := it.GetShelf(); s != nil {
			m = s.GetMapData()
		}
	}
	out := make([]*inventoryv1.BatchShelf, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		if r, ok := m[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

func costLayerRows(res *inventoryv1.CostLayerListResponse) []*inventoryv1.CostLayer {
	var m map[uint64]*inventoryv1.CostLayer
	for _, it := range res.GetItems() {
		if l := it.GetLayer(); l != nil {
			m = l.GetMapData()
		}
	}
	out := make([]*inventoryv1.CostLayer, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		if r, ok := m[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

func placementRows(res *inventoryv1.PlacementListResponse) []*inventoryv1.ProductPlacement {
	var m map[uint64]*inventoryv1.ProductPlacement
	for _, it := range res.GetItems() {
		if pl := it.GetPlacement(); pl != nil {
			m = pl.GetMapData()
		}
	}
	out := make([]*inventoryv1.ProductPlacement, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		if r, ok := m[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

// stockCostLines flattens the by-ids response to the StockCostLines (one per product id).
func stockCostLines(res *inventoryv1.StockCostResponse) []*inventoryv1.StockCostLine {
	out := []*inventoryv1.StockCostLine{}
	for id, list := range res.GetItems() {
		for _, it := range list.GetItems() {
			if c := it.GetCost(); c != nil {
				if line, ok := c.GetMapData()[id]; ok {
					out = append(out, line)
				}
			}
		}
	}
	return out
}

// productPlacesList flattens the by-ids response to every ProductPlace across all products. The
// by-ids map carries no order, so the pick-walk order (#151) — the unplaced pile first, then shelves
// by label — is derived here from each row's own rack_code, exactly as the wire order used to.
func productPlacesList(res *inventoryv1.ProductPlacesResponse) []*inventoryv1.ProductPlace {
	out := []*inventoryv1.ProductPlace{}
	for _, list := range res.GetItems() {
		for _, it := range list.GetItems() {
			if pl := it.GetPlace(); pl != nil {
				for _, place := range pl.GetMapData() {
					out = append(out, place)
				}
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if (a.GetRackId() == 0) != (b.GetRackId() == 0) {
			return a.GetRackId() == 0
		}
		return a.GetRackCode() < b.GetRackCode()
	})
	return out
}
