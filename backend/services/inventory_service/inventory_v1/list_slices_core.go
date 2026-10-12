package inventory_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// Guideline list/by-ids slice builders for inventory.proto core (guidelines/service-guideline.md).
// Each takes the already-built proto rows and wraps them in the flexible envelope.

func stockLevelItems(levels []*inventoryv1.StockLevel, types []inventoryv1.StockListDataType) ([]*inventoryv1.StockListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.StockListDataType{inventoryv1.StockListDataType_STOCK_LIST_DATA_TYPE_STOCK}
	}
	ids := make([]uint64, 0, len(levels))
	for _, l := range levels {
		ids = append(ids, l.GetProductId())
	}
	items := make([]*inventoryv1.StockListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.StockListDataType_STOCK_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(levels))
			for _, l := range levels {
				m[l.GetProductId()] = &commonv1.GeneralItem{Id: l.GetProductId()}
			}
			items = append(items, &inventoryv1.StockListResponseItem{D: &inventoryv1.StockListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}}})
		case inventoryv1.StockListDataType_STOCK_LIST_DATA_TYPE_STOCK:
			m := make(map[uint64]*inventoryv1.StockLevel, len(levels))
			for _, l := range levels {
				m[l.GetProductId()] = l
			}
			items = append(items, &inventoryv1.StockListResponseItem{D: &inventoryv1.StockListResponseItem_Stock{Stock: &inventoryv1.StockLevelMapItem{MapData: m}}})
		}
	}
	return items, ids
}

func stockHistoryItems(movements []*inventoryv1.StockMovement, types []inventoryv1.StockHistoryDataType) ([]*inventoryv1.StockHistoryResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.StockHistoryDataType{inventoryv1.StockHistoryDataType_STOCK_HISTORY_DATA_TYPE_MOVEMENT}
	}
	ids := make([]uint64, 0, len(movements))
	for _, mv := range movements {
		ids = append(ids, mv.GetId())
	}
	items := make([]*inventoryv1.StockHistoryResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.StockHistoryDataType_STOCK_HISTORY_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(movements))
			for _, mv := range movements {
				m[mv.GetId()] = &commonv1.GeneralItem{Id: mv.GetId()}
			}
			items = append(items, &inventoryv1.StockHistoryResponseItem{D: &inventoryv1.StockHistoryResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}}})
		case inventoryv1.StockHistoryDataType_STOCK_HISTORY_DATA_TYPE_MOVEMENT:
			m := make(map[uint64]*inventoryv1.StockMovement, len(movements))
			for _, mv := range movements {
				m[mv.GetId()] = mv
			}
			items = append(items, &inventoryv1.StockHistoryResponseItem{D: &inventoryv1.StockHistoryResponseItem_Movement{Movement: &inventoryv1.StockHistoryMapItem{MapData: m}}})
		}
	}
	return items, ids
}

// warehouseProductItems is a pure id list: the ids ARE the product ids; the only slice is GENERAL.
func warehouseProductItems(productIDs []uint64, types []inventoryv1.WarehouseProductListDataType) ([]*inventoryv1.WarehouseProductListResponseItem, []uint64) {
	items := make([]*inventoryv1.WarehouseProductListResponseItem, 0, len(types))
	for _, t := range types {
		if t == inventoryv1.WarehouseProductListDataType_WAREHOUSE_PRODUCT_LIST_DATA_TYPE_GENERAL {
			m := make(map[uint64]*commonv1.GeneralItem, len(productIDs))
			for _, id := range productIDs {
				m[id] = &commonv1.GeneralItem{Id: id}
			}
			items = append(items, &inventoryv1.WarehouseProductListResponseItem{D: &inventoryv1.WarehouseProductListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}}})
		}
	}
	return items, productIDs
}

func batchListItems(batches []*inventoryv1.StockBatch, types []inventoryv1.BatchListDataType) ([]*inventoryv1.BatchListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.BatchListDataType{inventoryv1.BatchListDataType_BATCH_LIST_DATA_TYPE_BATCH}
	}
	ids := make([]uint64, 0, len(batches))
	for _, b := range batches {
		ids = append(ids, b.GetId())
	}
	items := make([]*inventoryv1.BatchListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.BatchListDataType_BATCH_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(batches))
			for _, b := range batches {
				m[b.GetId()] = &commonv1.GeneralItem{Id: b.GetId()}
			}
			items = append(items, &inventoryv1.BatchListResponseItem{D: &inventoryv1.BatchListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}}})
		case inventoryv1.BatchListDataType_BATCH_LIST_DATA_TYPE_BATCH:
			m := make(map[uint64]*inventoryv1.StockBatch, len(batches))
			for _, b := range batches {
				m[b.GetId()] = b
			}
			items = append(items, &inventoryv1.BatchListResponseItem{D: &inventoryv1.BatchListResponseItem_Batch{Batch: &inventoryv1.BatchMapItem{MapData: m}}})
		}
	}
	return items, ids
}

func batchPlacementItems(shelves []*inventoryv1.BatchShelf, types []inventoryv1.BatchPlacementListDataType) ([]*inventoryv1.BatchPlacementListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.BatchPlacementListDataType{inventoryv1.BatchPlacementListDataType_BATCH_PLACEMENT_LIST_DATA_TYPE_SHELF}
	}
	ids := make([]uint64, 0, len(shelves))
	for _, sh := range shelves {
		ids = append(ids, sh.GetRackId())
	}
	items := make([]*inventoryv1.BatchPlacementListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.BatchPlacementListDataType_BATCH_PLACEMENT_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(shelves))
			for _, sh := range shelves {
				m[sh.GetRackId()] = &commonv1.GeneralItem{Id: sh.GetRackId()}
			}
			items = append(items, &inventoryv1.BatchPlacementListResponseItem{D: &inventoryv1.BatchPlacementListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}}})
		case inventoryv1.BatchPlacementListDataType_BATCH_PLACEMENT_LIST_DATA_TYPE_SHELF:
			m := make(map[uint64]*inventoryv1.BatchShelf, len(shelves))
			for _, sh := range shelves {
				m[sh.GetRackId()] = sh
			}
			items = append(items, &inventoryv1.BatchPlacementListResponseItem{D: &inventoryv1.BatchPlacementListResponseItem_Shelf{Shelf: &inventoryv1.BatchShelfMapItem{MapData: m}}})
		}
	}
	return items, ids
}

// costLayerItems keys CostLayers by their 1-based FIFO position (they have no id of their own).
func costLayerItems(layers []*inventoryv1.CostLayer, types []inventoryv1.CostLayerListDataType) ([]*inventoryv1.CostLayerListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.CostLayerListDataType{inventoryv1.CostLayerListDataType_COST_LAYER_LIST_DATA_TYPE_LAYER}
	}
	ids := make([]uint64, 0, len(layers))
	for i := range layers {
		ids = append(ids, uint64(i+1))
	}
	items := make([]*inventoryv1.CostLayerListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.CostLayerListDataType_COST_LAYER_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(layers))
			for i := range layers {
				m[uint64(i+1)] = &commonv1.GeneralItem{Id: uint64(i + 1)}
			}
			items = append(items, &inventoryv1.CostLayerListResponseItem{D: &inventoryv1.CostLayerListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}}})
		case inventoryv1.CostLayerListDataType_COST_LAYER_LIST_DATA_TYPE_LAYER:
			m := make(map[uint64]*inventoryv1.CostLayer, len(layers))
			for i, l := range layers {
				m[uint64(i+1)] = l
			}
			items = append(items, &inventoryv1.CostLayerListResponseItem{D: &inventoryv1.CostLayerListResponseItem_Layer{Layer: &inventoryv1.CostLayerMapItem{MapData: m}}})
		}
	}
	return items, ids
}

func placementItems(placements []*inventoryv1.ProductPlacement, types []inventoryv1.PlacementListDataType) ([]*inventoryv1.PlacementListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.PlacementListDataType{inventoryv1.PlacementListDataType_PLACEMENT_LIST_DATA_TYPE_PLACEMENT}
	}
	ids := make([]uint64, 0, len(placements))
	for _, pl := range placements {
		ids = append(ids, pl.GetRackId())
	}
	items := make([]*inventoryv1.PlacementListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.PlacementListDataType_PLACEMENT_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(placements))
			for _, pl := range placements {
				m[pl.GetRackId()] = &commonv1.GeneralItem{Id: pl.GetRackId()}
			}
			items = append(items, &inventoryv1.PlacementListResponseItem{D: &inventoryv1.PlacementListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}}})
		case inventoryv1.PlacementListDataType_PLACEMENT_LIST_DATA_TYPE_PLACEMENT:
			m := make(map[uint64]*inventoryv1.ProductPlacement, len(placements))
			for _, pl := range placements {
				m[pl.GetRackId()] = pl
			}
			items = append(items, &inventoryv1.PlacementListResponseItem{D: &inventoryv1.PlacementListResponseItem_Placement{Placement: &inventoryv1.ProductPlacementMapItem{MapData: m}}})
		}
	}
	return items, ids
}

// stockCostMap is the by-ids response: one StockCostLine per product id.
func stockCostMap(lines []*inventoryv1.StockCostLine, types []inventoryv1.StockCostDataType) map[uint64]*inventoryv1.StockCostResponseList {
	if len(types) == 0 {
		types = []inventoryv1.StockCostDataType{inventoryv1.StockCostDataType_STOCK_COST_DATA_TYPE_COST}
	}
	out := make(map[uint64]*inventoryv1.StockCostResponseList, len(lines))
	for _, ln := range lines {
		slices := make([]*inventoryv1.StockCostResponseItem, 0, len(types))
		for _, t := range types {
			switch t {
			case inventoryv1.StockCostDataType_STOCK_COST_DATA_TYPE_GENERAL:
				slices = append(slices, &inventoryv1.StockCostResponseItem{D: &inventoryv1.StockCostResponseItem_General{General: &commonv1.GeneralMapItem{MapData: map[uint64]*commonv1.GeneralItem{ln.GetProductId(): {Id: ln.GetProductId()}}}}})
			case inventoryv1.StockCostDataType_STOCK_COST_DATA_TYPE_COST:
				slices = append(slices, &inventoryv1.StockCostResponseItem{D: &inventoryv1.StockCostResponseItem_Cost{Cost: &inventoryv1.StockCostLineMapItem{MapData: map[uint64]*inventoryv1.StockCostLine{ln.GetProductId(): ln}}}})
			}
		}
		out[ln.GetProductId()] = &inventoryv1.StockCostResponseList{Items: slices}
	}
	return out
}

// productPlacesMap is the by-ids response keyed by product id; a product sits on several racks, so
// the PLACE slice maps those by rack_id.
func productPlacesMap(places []*inventoryv1.ProductPlace, types []inventoryv1.ProductPlacesDataType) map[uint64]*inventoryv1.ProductPlacesResponseList {
	if len(types) == 0 {
		types = []inventoryv1.ProductPlacesDataType{inventoryv1.ProductPlacesDataType_PRODUCT_PLACES_DATA_TYPE_PLACE}
	}
	byProduct := map[uint64][]*inventoryv1.ProductPlace{}
	order := make([]uint64, 0)
	for _, pl := range places {
		if _, ok := byProduct[pl.GetProductId()]; !ok {
			order = append(order, pl.GetProductId())
		}
		byProduct[pl.GetProductId()] = append(byProduct[pl.GetProductId()], pl)
	}
	out := make(map[uint64]*inventoryv1.ProductPlacesResponseList, len(order))
	for _, pid := range order {
		pls := byProduct[pid]
		slices := make([]*inventoryv1.ProductPlacesResponseItem, 0, len(types))
		for _, t := range types {
			switch t {
			case inventoryv1.ProductPlacesDataType_PRODUCT_PLACES_DATA_TYPE_GENERAL:
				slices = append(slices, &inventoryv1.ProductPlacesResponseItem{D: &inventoryv1.ProductPlacesResponseItem_General{General: &commonv1.GeneralMapItem{MapData: map[uint64]*commonv1.GeneralItem{pid: {Id: pid}}}}})
			case inventoryv1.ProductPlacesDataType_PRODUCT_PLACES_DATA_TYPE_PLACE:
				m := make(map[uint64]*inventoryv1.ProductPlace, len(pls))
				for _, pl := range pls {
					m[pl.GetRackId()] = pl
				}
				slices = append(slices, &inventoryv1.ProductPlacesResponseItem{D: &inventoryv1.ProductPlacesResponseItem_Place{Place: &inventoryv1.ProductPlaceMapItem{MapData: m}}})
			}
		}
		out[pid] = &inventoryv1.ProductPlacesResponseList{Items: slices}
	}
	return out
}
