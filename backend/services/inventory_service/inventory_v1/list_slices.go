package inventory_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// The guideline list slice builders (guidelines/service-guideline.md) for inventory_service. Each
// slice reuses its entity message directly where the entity already IS the list row.

// ── Racks ─────────────────────────────────────────────────────────────────────────────────────────

func rackOrderClause(sort *inventoryv1.RackListFilterSort) string {
	col := "code"
	dir := "ASC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
			dir = "DESC"
		}

		switch s := sort.GetS().(type) {
		case *inventoryv1.RackListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "code"
			}
		case *inventoryv1.RackListFilterSort_Rack:
			switch s.Rack {
			case inventoryv1.RackRowSort_RACK_ROW_SORT_ID:
				col = "id"
			case inventoryv1.RackRowSort_RACK_ROW_SORT_CODE:
				col = "code"
			}
		}
	}

	return col + " " + dir
}

func rackListItems(
	racks []inventory_service_models.Rack,
	types []inventoryv1.RackListDataType,
) ([]*inventoryv1.RackListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.RackListDataType{inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_RACK}
	}

	ids := make([]uint64, 0, len(racks))
	for i := range racks {
		ids = append(ids, racks[i].ID)
	}

	items := make([]*inventoryv1.RackListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(racks))
			for i := range racks {
				m[racks[i].ID] = &commonv1.GeneralItem{Id: racks[i].ID, Name: racks[i].Code}
			}
			items = append(items, &inventoryv1.RackListResponseItem{
				D: &inventoryv1.RackListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_RACK:
			m := make(map[uint64]*inventoryv1.Rack, len(racks))
			for i := range racks {
				m[racks[i].ID] = rackToProto(&racks[i])
			}
			items = append(items, &inventoryv1.RackListResponseItem{
				D: &inventoryv1.RackListResponseItem_Rack{Rack: &inventoryv1.RackRowMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// rackStockListItems wraps already-built RackStockLines, keyed by product_id (their identity here).
func rackStockListItems(
	lines []*inventoryv1.RackStockLine,
	types []inventoryv1.RackStockDataType,
) ([]*inventoryv1.RackStockResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.RackStockDataType{inventoryv1.RackStockDataType_RACK_STOCK_DATA_TYPE_RACK_STOCK}
	}

	ids := make([]uint64, 0, len(lines))
	for _, l := range lines {
		ids = append(ids, l.GetProductId())
	}

	items := make([]*inventoryv1.RackStockResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.RackStockDataType_RACK_STOCK_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(lines))
			for _, l := range lines {
				m[l.GetProductId()] = &commonv1.GeneralItem{Id: l.GetProductId()}
			}
			items = append(items, &inventoryv1.RackStockResponseItem{
				D: &inventoryv1.RackStockResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.RackStockDataType_RACK_STOCK_DATA_TYPE_RACK_STOCK:
			m := make(map[uint64]*inventoryv1.RackStockLine, len(lines))
			for _, l := range lines {
				m[l.GetProductId()] = l
			}
			items = append(items, &inventoryv1.RackStockResponseItem{
				D: &inventoryv1.RackStockResponseItem_RackStock{RackStock: &inventoryv1.RackStockMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// rackHistoryListItems wraps already-built StockMovements, keyed by id.
func rackHistoryListItems(
	movements []*inventoryv1.StockMovement,
	types []inventoryv1.RackHistoryDataType,
) ([]*inventoryv1.RackHistoryResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.RackHistoryDataType{inventoryv1.RackHistoryDataType_RACK_HISTORY_DATA_TYPE_MOVEMENT}
	}

	ids := make([]uint64, 0, len(movements))
	for _, mv := range movements {
		ids = append(ids, mv.GetId())
	}

	items := make([]*inventoryv1.RackHistoryResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.RackHistoryDataType_RACK_HISTORY_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(movements))
			for _, mv := range movements {
				m[mv.GetId()] = &commonv1.GeneralItem{Id: mv.GetId()}
			}
			items = append(items, &inventoryv1.RackHistoryResponseItem{
				D: &inventoryv1.RackHistoryResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.RackHistoryDataType_RACK_HISTORY_DATA_TYPE_MOVEMENT:
			m := make(map[uint64]*inventoryv1.StockMovement, len(movements))
			for _, mv := range movements {
				m[mv.GetId()] = mv
			}
			items = append(items, &inventoryv1.RackHistoryResponseItem{
				D: &inventoryv1.RackHistoryResponseItem_Movement{Movement: &inventoryv1.RackHistoryMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// ── Restock requests ──────────────────────────────────────────────────────────────────────────────

// restockRequestListItems wraps the proto requests (already built with their preloaded items).
func restockRequestListItems(
	rrs []*inventoryv1.RestockRequest,
	types []inventoryv1.RestockRequestListDataType,
) ([]*inventoryv1.RestockRequestListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.RestockRequestListDataType{inventoryv1.RestockRequestListDataType_RESTOCK_REQUEST_LIST_DATA_TYPE_RESTOCK_REQUEST}
	}

	ids := make([]uint64, 0, len(rrs))
	for _, r := range rrs {
		ids = append(ids, r.GetId())
	}

	items := make([]*inventoryv1.RestockRequestListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.RestockRequestListDataType_RESTOCK_REQUEST_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(rrs))
			for _, r := range rrs {
				m[r.GetId()] = &commonv1.GeneralItem{Id: r.GetId()}
			}
			items = append(items, &inventoryv1.RestockRequestListResponseItem{
				D: &inventoryv1.RestockRequestListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.RestockRequestListDataType_RESTOCK_REQUEST_LIST_DATA_TYPE_RESTOCK_REQUEST:
			m := make(map[uint64]*inventoryv1.RestockRequest, len(rrs))
			for _, r := range rrs {
				m[r.GetId()] = r
			}
			items = append(items, &inventoryv1.RestockRequestListResponseItem{
				D: &inventoryv1.RestockRequestListResponseItem_RestockRequest{RestockRequest: &inventoryv1.RestockRequestMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}
