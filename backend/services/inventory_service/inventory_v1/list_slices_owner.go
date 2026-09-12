package inventory_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// Guideline slice builders for the CATALOGUE OWNER's row-level reads (#232).
//
// Two of the three reuse the warehouse-side response envelope: an owner's cost layer and a warehouse's
// cost layer are the same fact about the same units, and a parallel message for each would be two
// screens' worth of vocabulary for one idea. Only the history has its own — see OwnerMovement in the
// proto for why a shelf's ledger row is not the owner's.

// ownerCostLayerItems maps the owner's data-request onto the shared cost-layer envelope.
func ownerCostLayerItems(
	layers []*inventoryv1.CostLayer,
	types []inventoryv1.OwnerCostLayerListDataType,
) ([]*inventoryv1.CostLayerListResponseItem, []uint64) {
	mapped := make([]inventoryv1.CostLayerListDataType, 0, len(types))

	for _, t := range types {
		switch t {
		case inventoryv1.OwnerCostLayerListDataType_OWNER_COST_LAYER_LIST_DATA_TYPE_GENERAL:
			mapped = append(mapped, inventoryv1.CostLayerListDataType_COST_LAYER_LIST_DATA_TYPE_GENERAL)
		case inventoryv1.OwnerCostLayerListDataType_OWNER_COST_LAYER_LIST_DATA_TYPE_LAYER:
			mapped = append(mapped, inventoryv1.CostLayerListDataType_COST_LAYER_LIST_DATA_TYPE_LAYER)
		}
	}

	return costLayerItems(layers, mapped)
}

// ownerBatchItems maps the owner's data-request onto the shared batch envelope.
func ownerBatchItems(
	batches []*inventoryv1.StockBatch,
	types []inventoryv1.OwnerBatchListDataType,
) ([]*inventoryv1.BatchListResponseItem, []uint64) {
	mapped := make([]inventoryv1.BatchListDataType, 0, len(types))

	for _, t := range types {
		switch t {
		case inventoryv1.OwnerBatchListDataType_OWNER_BATCH_LIST_DATA_TYPE_GENERAL:
			mapped = append(mapped, inventoryv1.BatchListDataType_BATCH_LIST_DATA_TYPE_GENERAL)
		case inventoryv1.OwnerBatchListDataType_OWNER_BATCH_LIST_DATA_TYPE_BATCH:
			mapped = append(mapped, inventoryv1.BatchListDataType_BATCH_LIST_DATA_TYPE_BATCH)
		}
	}

	return batchListItems(batches, mapped)
}

// ownerHistoryItems wraps the owner's ledger rows, keyed by the projection's own id.
func ownerHistoryItems(
	movements []*inventoryv1.OwnerMovement,
	types []inventoryv1.OwnerStockHistoryDataType,
) ([]*inventoryv1.OwnerStockHistoryResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.OwnerStockHistoryDataType{
			inventoryv1.OwnerStockHistoryDataType_OWNER_STOCK_HISTORY_DATA_TYPE_MOVEMENT,
		}
	}

	ids := make([]uint64, 0, len(movements))
	for _, mv := range movements {
		ids = append(ids, mv.GetId())
	}

	items := make([]*inventoryv1.OwnerStockHistoryResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case inventoryv1.OwnerStockHistoryDataType_OWNER_STOCK_HISTORY_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(movements))
			for _, mv := range movements {
				m[mv.GetId()] = &commonv1.GeneralItem{Id: mv.GetId()}
			}

			items = append(items, &inventoryv1.OwnerStockHistoryResponseItem{
				D: &inventoryv1.OwnerStockHistoryResponseItem_General{
					General: &commonv1.GeneralMapItem{MapData: m},
				},
			})
		case inventoryv1.OwnerStockHistoryDataType_OWNER_STOCK_HISTORY_DATA_TYPE_MOVEMENT:
			m := make(map[uint64]*inventoryv1.OwnerMovement, len(movements))
			for _, mv := range movements {
				m[mv.GetId()] = mv
			}

			items = append(items, &inventoryv1.OwnerStockHistoryResponseItem{
				D: &inventoryv1.OwnerStockHistoryResponseItem_Movement{
					Movement: &inventoryv1.OwnerMovementMapItem{MapData: m},
				},
			})
		}
	}

	return items, ids
}
