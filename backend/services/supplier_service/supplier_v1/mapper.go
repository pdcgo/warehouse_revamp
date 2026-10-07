package supplier_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

func supplierToProto(s *supplier_service_models.Supplier) *supplierv1.Supplier {
	return &supplierv1.Supplier{
		Id:          s.ID,
		TeamId:      s.TeamID,
		Name:        s.Name,
		Contact:     s.Contact,
		Address:     s.Address,
		Description: s.Description,
		Deleted:     s.DeletedAt != nil,
	}
}

func channelToProto(c *supplier_service_models.SupplierChannel) *supplierv1.SupplierChannel {
	return &supplierv1.SupplierChannel{
		Id:          c.ID,
		SupplierId:  c.SupplierID,
		ChannelType: san_marketplace.FromText(c.ChannelType),
		Name:        c.Name,
		Uri:         c.URI,
		Description: c.Description,
	}
}

// ── SupplierList ────────────────────────────────────────────────────────────────────────────────

func supplierOrderClause(sort *supplierv1.SupplierListFilterSort) string {
	col := "id"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *supplierv1.SupplierListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "name"
			}
		case *supplierv1.SupplierListFilterSort_Supplier:
			if s.Supplier == supplierv1.SupplierRowSort_SUPPLIER_ROW_SORT_NAME {
				col = "name"
			}
		}
	}

	// id breaks a tie on name, so a page boundary never repeats or skips a row.
	if col == "id" {
		return "id " + dir
	}

	return col + " " + dir + ", id " + dir
}

// supplierListItems builds the requested slices for one page. `channels` is the page's live stores, keyed
// by supplier — loaded only when the CHANNELS slice is asked for.
func supplierListItems(
	suppliers []supplier_service_models.Supplier,
	channels map[uint64][]supplier_service_models.SupplierChannel,
	types []supplierv1.SupplierListDataType,
) []*supplierv1.SupplierListResponseItem {
	items := make([]*supplierv1.SupplierListResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(suppliers))
			for i := range suppliers {
				m[suppliers[i].ID] = &commonv1.GeneralItem{Id: suppliers[i].ID, Name: suppliers[i].Name}
			}

			items = append(items, &supplierv1.SupplierListResponseItem{
				D: &supplierv1.SupplierListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_SUPPLIER:
			m := make(map[uint64]*supplierv1.Supplier, len(suppliers))
			for i := range suppliers {
				m[suppliers[i].ID] = supplierToProto(&suppliers[i])
			}

			items = append(items, &supplierv1.SupplierListResponseItem{
				D: &supplierv1.SupplierListResponseItem_Supplier{Supplier: &supplierv1.SupplierRowMapItem{MapData: m}},
			})
		case supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_CHANNELS:
			// Every supplier on the page gets an entry, an empty set included — "no stores" is an answer.
			m := make(map[uint64]*supplierv1.SupplierChannelSet, len(suppliers))
			for i := range suppliers {
				own := channels[suppliers[i].ID]

				set := &supplierv1.SupplierChannelSet{Channels: make([]*supplierv1.SupplierChannel, 0, len(own))}
				for j := range own {
					set.Channels = append(set.Channels, channelToProto(&own[j]))
				}

				m[suppliers[i].ID] = set
			}

			items = append(items, &supplierv1.SupplierListResponseItem{
				D: &supplierv1.SupplierListResponseItem_Channels{Channels: &supplierv1.SupplierChannelsMapItem{MapData: m}},
			})
		}
	}

	return items
}

// ── SupplierByIds ───────────────────────────────────────────────────────────────────────────────

// supplierByIdsMap keys one response list PER SUPPLIER: a by-ids caller looks each id up on its own, so
// an id it asked for and did not get back is answered by the key being absent.
func supplierByIdsMap(
	suppliers []supplier_service_models.Supplier,
	types []supplierv1.SupplierByIdsDataType,
) map[uint64]*supplierv1.SupplierByIdsResponseList {
	if len(types) == 0 {
		types = []supplierv1.SupplierByIdsDataType{supplierv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_SUPPLIER}
	}

	out := make(map[uint64]*supplierv1.SupplierByIdsResponseList, len(suppliers))

	for i := range suppliers {
		supplier := &suppliers[i]
		slices := make([]*supplierv1.SupplierByIdsResponseItem, 0, len(types))

		for _, t := range types {
			switch t {
			case supplierv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_GENERAL:
				slices = append(slices, &supplierv1.SupplierByIdsResponseItem{
					D: &supplierv1.SupplierByIdsResponseItem_General{General: &commonv1.GeneralMapItem{
						MapData: map[uint64]*commonv1.GeneralItem{supplier.ID: {Id: supplier.ID, Name: supplier.Name}},
					}},
				})
			case supplierv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_SUPPLIER:
				slices = append(slices, &supplierv1.SupplierByIdsResponseItem{
					D: &supplierv1.SupplierByIdsResponseItem_Supplier{Supplier: &supplierv1.SupplierRowMapItem{
						MapData: map[uint64]*supplierv1.Supplier{supplier.ID: supplierToProto(supplier)},
					}},
				})
			}
		}

		out[supplier.ID] = &supplierv1.SupplierByIdsResponseList{Items: slices}
	}

	return out
}

// ── SupplierChannelList ─────────────────────────────────────────────────────────────────────────

func channelOrderClause(sort *supplierv1.SupplierChannelListFilterSort) string {
	col := "id"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *supplierv1.SupplierChannelListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "name"
			}
		case *supplierv1.SupplierChannelListFilterSort_Channel:
			switch s.Channel {
			case supplierv1.SupplierChannelRowSort_SUPPLIER_CHANNEL_ROW_SORT_NAME:
				col = "name"
			case supplierv1.SupplierChannelRowSort_SUPPLIER_CHANNEL_ROW_SORT_CHANNEL_TYPE:
				col = "channel_type"
			}
		}
	}

	if col == "id" {
		return "id " + dir
	}

	return col + " " + dir + ", id " + dir
}

func channelListItems(
	channels []supplier_service_models.SupplierChannel,
	types []supplierv1.SupplierChannelListDataType,
) ([]*supplierv1.SupplierChannelListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []supplierv1.SupplierChannelListDataType{
			supplierv1.SupplierChannelListDataType_SUPPLIER_CHANNEL_LIST_DATA_TYPE_SUPPLIER_CHANNEL,
		}
	}

	ids := make([]uint64, 0, len(channels))
	for i := range channels {
		ids = append(ids, channels[i].ID)
	}

	items := make([]*supplierv1.SupplierChannelListResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case supplierv1.SupplierChannelListDataType_SUPPLIER_CHANNEL_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(channels))
			for i := range channels {
				m[channels[i].ID] = &commonv1.GeneralItem{Id: channels[i].ID, Name: channels[i].Name}
			}

			items = append(items, &supplierv1.SupplierChannelListResponseItem{
				D: &supplierv1.SupplierChannelListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case supplierv1.SupplierChannelListDataType_SUPPLIER_CHANNEL_LIST_DATA_TYPE_SUPPLIER_CHANNEL:
			m := make(map[uint64]*supplierv1.SupplierChannel, len(channels))
			for i := range channels {
				m[channels[i].ID] = channelToProto(&channels[i])
			}

			items = append(items, &supplierv1.SupplierChannelListResponseItem{
				D: &supplierv1.SupplierChannelListResponseItem_SupplierChannel{
					SupplierChannel: &supplierv1.SupplierChannelMapItem{MapData: m},
				},
			})
		}
	}

	return items, ids
}
