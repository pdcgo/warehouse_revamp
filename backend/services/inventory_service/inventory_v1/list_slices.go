package inventory_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// The guideline list slice builders (guidelines/service-guideline.md) for inventory_service. Each
// slice reuses its entity message directly where the entity already IS the list row.

// ── Suppliers ─────────────────────────────────────────────────────────────────────────────────────

func supplierOrderClause(sort *inventoryv1.SupplierListFilterSort) string {
	col := "id"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *inventoryv1.SupplierListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "name"
			}
		case *inventoryv1.SupplierListFilterSort_Supplier:
			switch s.Supplier {
			case inventoryv1.SupplierRowSort_SUPPLIER_ROW_SORT_NAME:
				col = "name"
			case inventoryv1.SupplierRowSort_SUPPLIER_ROW_SORT_CODE:
				col = "code"
			case inventoryv1.SupplierRowSort_SUPPLIER_ROW_SORT_ID:
				col = "id"
			}
		}
	}

	return col + " " + dir
}

func supplierListItems(
	suppliers []inventory_service_models.Supplier,
	types []inventoryv1.SupplierListDataType,
) ([]*inventoryv1.SupplierListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.SupplierListDataType{inventoryv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_SUPPLIER}
	}

	ids := make([]uint64, 0, len(suppliers))
	for i := range suppliers {
		ids = append(ids, suppliers[i].ID)
	}

	items := make([]*inventoryv1.SupplierListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(suppliers))
			for i := range suppliers {
				m[suppliers[i].ID] = &commonv1.GeneralItem{Id: suppliers[i].ID, Name: suppliers[i].Name}
			}
			items = append(items, &inventoryv1.SupplierListResponseItem{
				D: &inventoryv1.SupplierListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_SUPPLIER:
			m := make(map[uint64]*inventoryv1.Supplier, len(suppliers))
			for i := range suppliers {
				m[suppliers[i].ID] = supplierToProto(&suppliers[i])
			}
			items = append(items, &inventoryv1.SupplierListResponseItem{
				D: &inventoryv1.SupplierListResponseItem_Supplier{Supplier: &inventoryv1.SupplierRowMapItem{MapData: m}},
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

// ── Supplier channels ─────────────────────────────────────────────────────────────────────────────

func supplierChannelListItems(
	channels []inventory_service_models.SupplierChannel,
	types []inventoryv1.SupplierChannelListDataType,
) ([]*inventoryv1.SupplierChannelListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.SupplierChannelListDataType{inventoryv1.SupplierChannelListDataType_SUPPLIER_CHANNEL_LIST_DATA_TYPE_SUPPLIER_CHANNEL}
	}

	ids := make([]uint64, 0, len(channels))
	for i := range channels {
		ids = append(ids, channels[i].ID)
	}

	items := make([]*inventoryv1.SupplierChannelListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case inventoryv1.SupplierChannelListDataType_SUPPLIER_CHANNEL_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(channels))
			for i := range channels {
				m[channels[i].ID] = &commonv1.GeneralItem{Id: channels[i].ID, Name: channels[i].Name}
			}
			items = append(items, &inventoryv1.SupplierChannelListResponseItem{
				D: &inventoryv1.SupplierChannelListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.SupplierChannelListDataType_SUPPLIER_CHANNEL_LIST_DATA_TYPE_SUPPLIER_CHANNEL:
			m := make(map[uint64]*inventoryv1.SupplierChannel, len(channels))
			for i := range channels {
				m[channels[i].ID] = supplierChannelToProto(&channels[i])
			}
			items = append(items, &inventoryv1.SupplierChannelListResponseItem{
				D: &inventoryv1.SupplierChannelListResponseItem_SupplierChannel{SupplierChannel: &inventoryv1.SupplierChannelMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}
