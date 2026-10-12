package selling_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The guideline list slice builders (guidelines/service-guideline.md). The ORDER / ORDER_DRAFT / SHOP
// slices reuse the Order / OrderDraft / Shop messages directly. ShopUserList has no entity — it is a
// pure id list, so its ids ARE the user ids and its only slice is GENERAL (id only).

// ── Orders ────────────────────────────────────────────────────────────────────────────────────────

func orderOrderClause(sort *sellingv1.OrderListFilterSort) string {
	col := "id"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		if s, ok := sort.GetS().(*sellingv1.OrderListFilterSort_Order); ok {
			if s.Order == sellingv1.OrderRowSort_ORDER_ROW_SORT_TOTAL {
				col = "total"
			}
		}
	}

	return col + " " + dir
}

func orderListItems(
	orders []selling_service_models.Order,
	types []sellingv1.OrderListDataType,
) ([]*sellingv1.OrderListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []sellingv1.OrderListDataType{sellingv1.OrderListDataType_ORDER_LIST_DATA_TYPE_ORDER}
	}

	ids := make([]uint64, 0, len(orders))
	for i := range orders {
		ids = append(ids, orders[i].ID)
	}

	items := make([]*sellingv1.OrderListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case sellingv1.OrderListDataType_ORDER_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(orders))
			for i := range orders {
				m[orders[i].ID] = &commonv1.GeneralItem{Id: orders[i].ID, Name: orders[i].CustomerName}
			}
			items = append(items, &sellingv1.OrderListResponseItem{
				D: &sellingv1.OrderListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case sellingv1.OrderListDataType_ORDER_LIST_DATA_TYPE_ORDER:
			m := make(map[uint64]*sellingv1.Order, len(orders))
			for i := range orders {
				m[orders[i].ID] = orderToProto(&orders[i])
			}
			items = append(items, &sellingv1.OrderListResponseItem{
				D: &sellingv1.OrderListResponseItem_Order{Order: &sellingv1.OrderRowMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// ── Order drafts ────────────────────────────────────────────────────────────────────────────────

func draftOrderClause(sort *sellingv1.OrderDraftListFilterSort) string {
	dir := "DESC"
	if sort != nil && sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
		dir = "ASC"
	}

	return "id " + dir
}

// draftListItems wraps the proto drafts (already built with item counts, in display order).
func draftListItems(
	drafts []*sellingv1.OrderDraft,
	types []sellingv1.OrderDraftListDataType,
) ([]*sellingv1.OrderDraftListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []sellingv1.OrderDraftListDataType{sellingv1.OrderDraftListDataType_ORDER_DRAFT_LIST_DATA_TYPE_ORDER_DRAFT}
	}

	ids := make([]uint64, 0, len(drafts))
	for _, d := range drafts {
		ids = append(ids, d.GetId())
	}

	items := make([]*sellingv1.OrderDraftListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case sellingv1.OrderDraftListDataType_ORDER_DRAFT_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(drafts))
			for _, d := range drafts {
				m[d.GetId()] = &commonv1.GeneralItem{Id: d.GetId(), Name: d.GetCustomerName()}
			}
			items = append(items, &sellingv1.OrderDraftListResponseItem{
				D: &sellingv1.OrderDraftListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case sellingv1.OrderDraftListDataType_ORDER_DRAFT_LIST_DATA_TYPE_ORDER_DRAFT:
			m := make(map[uint64]*sellingv1.OrderDraft, len(drafts))
			for _, d := range drafts {
				m[d.GetId()] = d
			}
			items = append(items, &sellingv1.OrderDraftListResponseItem{
				D: &sellingv1.OrderDraftListResponseItem_OrderDraft{OrderDraft: &sellingv1.OrderDraftRowMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// ── Shops ───────────────────────────────────────────────────────────────────────────────────────

func shopOrderClause(sort *sellingv1.ShopListFilterSort) string {
	col := "id"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *sellingv1.ShopListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "name"
			}
		case *sellingv1.ShopListFilterSort_Shop:
			switch s.Shop {
			case sellingv1.ShopRowSort_SHOP_ROW_SORT_NAME:
				col = "name"
			case sellingv1.ShopRowSort_SHOP_ROW_SORT_SHOP_CODE:
				col = "shop_code"
			case sellingv1.ShopRowSort_SHOP_ROW_SORT_ID:
				col = "id"
			}
		}
	}

	return col + " " + dir
}

func shopListItems(
	shops []selling_service_models.Shop,
	types []sellingv1.ShopListDataType,
) ([]*sellingv1.ShopListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []sellingv1.ShopListDataType{sellingv1.ShopListDataType_SHOP_LIST_DATA_TYPE_SHOP}
	}

	ids := make([]uint64, 0, len(shops))
	for i := range shops {
		ids = append(ids, shops[i].ID)
	}

	items := make([]*sellingv1.ShopListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case sellingv1.ShopListDataType_SHOP_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(shops))
			for i := range shops {
				m[shops[i].ID] = &commonv1.GeneralItem{Id: shops[i].ID, Name: shops[i].Name}
			}
			items = append(items, &sellingv1.ShopListResponseItem{
				D: &sellingv1.ShopListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case sellingv1.ShopListDataType_SHOP_LIST_DATA_TYPE_SHOP:
			m := make(map[uint64]*sellingv1.Shop, len(shops))
			for i := range shops {
				m[shops[i].ID] = toProto(&shops[i])
			}
			items = append(items, &sellingv1.ShopListResponseItem{
				D: &sellingv1.ShopListResponseItem_Shop{Shop: &sellingv1.ShopRowMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// ── Shop users (pure id list) ─────────────────────────────────────────────────────────────────────

func shopUserListItems(
	userIDs []uint64,
	types []sellingv1.ShopUserListDataType,
) ([]*sellingv1.ShopUserListResponseItem, []uint64) {
	items := make([]*sellingv1.ShopUserListResponseItem, 0, len(types))
	for _, t := range types {
		if t == sellingv1.ShopUserListDataType_SHOP_USER_LIST_DATA_TYPE_GENERAL {
			m := make(map[uint64]*commonv1.GeneralItem, len(userIDs))
			for _, id := range userIDs {
				m[id] = &commonv1.GeneralItem{Id: id}
			}
			items = append(items, &sellingv1.ShopUserListResponseItem{
				D: &sellingv1.ShopUserListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		}
	}

	return items, userIDs
}
