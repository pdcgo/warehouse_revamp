package shipment_v1

import (
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
)

func toProto(c *shipment_service_models.ShipmentChannel) *shipmentv1.ShipmentChannel {
	return &shipmentv1.ShipmentChannel{
		Id:        c.ID,
		Code:      c.Code,
		Name:      c.Name,
		Desc:      c.Desc,
		IsDeleted: c.IsDeleted,
		CreatedAt: timestamppb.New(c.CreatedAt),
		UpdatedAt: timestamppb.New(c.UpdatedAt),
	}
}

func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

func pageOffset(page *commonv1.CommonPagination) int {
	return int((page.GetPage() - 1) * page.GetLimit())
}

func pageInfo(page *commonv1.CommonPagination, total int64) *commonv1.PageInfo {
	var totalPage uint32

	limit := page.GetLimit()
	if limit > 0 {
		totalPage = uint32((total + int64(limit) - 1) / int64(limit))
	}

	return &commonv1.PageInfo{
		CurrentPage: page.GetPage(),
		TotalPage:   totalPage,
		TotalItems:  uint64(total),
	}
}

// orderClause defaults to code ascending — a catalogue is read alphabetically. `id` breaks ties so a
// page boundary is stable.
func orderClause(sort *shipmentv1.ShipmentChannelListFilterSort) string {
	col := "code"
	dir := "ASC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
			dir = "DESC"
		}

		switch s := sort.GetS().(type) {
		case *shipmentv1.ShipmentChannelListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "name"
			}
		case *shipmentv1.ShipmentChannelListFilterSort_Channel:
			switch s.Channel {
			case shipmentv1.ShipmentChannelRowSort_SHIPMENT_CHANNEL_ROW_SORT_NAME:
				col = "name"
			case shipmentv1.ShipmentChannelRowSort_SHIPMENT_CHANNEL_ROW_SORT_UPDATED_AT:
				col = "updated_at"
			}
		}
	}

	return col + " " + dir + ", id " + dir
}

func listItems(
	channels []shipment_service_models.ShipmentChannel,
	types []shipmentv1.ShipmentChannelListDataType,
) ([]*shipmentv1.ShipmentChannelListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []shipmentv1.ShipmentChannelListDataType{shipmentv1.ShipmentChannelListDataType_SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL}
	}

	ids := make([]uint64, 0, len(channels))
	general := make(map[uint64]*commonv1.GeneralItem, len(channels))
	rows := make(map[uint64]*shipmentv1.ShipmentChannel, len(channels))

	for i := range channels {
		c := &channels[i]
		ids = append(ids, c.ID)
		general[c.ID] = &commonv1.GeneralItem{Id: c.ID, Name: c.Name}
		rows[c.ID] = toProto(c)
	}

	items := make([]*shipmentv1.ShipmentChannelListResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case shipmentv1.ShipmentChannelListDataType_SHIPMENT_CHANNEL_LIST_DATA_TYPE_GENERAL:
			items = append(items, &shipmentv1.ShipmentChannelListResponseItem{
				D: &shipmentv1.ShipmentChannelListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: general}},
			})
		case shipmentv1.ShipmentChannelListDataType_SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL:
			items = append(items, &shipmentv1.ShipmentChannelListResponseItem{
				D: &shipmentv1.ShipmentChannelListResponseItem_Channel{Channel: &shipmentv1.ShipmentChannelRowMapItem{MapData: rows}},
			})
		}
	}

	return items, ids
}

// byIdsMap keys one list PER CHANNEL — an id asked for and not returned is simply absent.
func byIdsMap(
	channels []shipment_service_models.ShipmentChannel,
	types []shipmentv1.ShipmentChannelByIdsDataType,
) map[uint64]*shipmentv1.ShipmentChannelByIdsResponseList {
	if len(types) == 0 {
		types = []shipmentv1.ShipmentChannelByIdsDataType{shipmentv1.ShipmentChannelByIdsDataType_SHIPMENT_CHANNEL_BY_IDS_DATA_TYPE_CHANNEL}
	}

	out := make(map[uint64]*shipmentv1.ShipmentChannelByIdsResponseList, len(channels))

	for i := range channels {
		c := &channels[i]
		slices := make([]*shipmentv1.ShipmentChannelByIdsResponseItem, 0, len(types))

		for _, t := range types {
			switch t {
			case shipmentv1.ShipmentChannelByIdsDataType_SHIPMENT_CHANNEL_BY_IDS_DATA_TYPE_GENERAL:
				slices = append(slices, &shipmentv1.ShipmentChannelByIdsResponseItem{
					D: &shipmentv1.ShipmentChannelByIdsResponseItem_General{General: &commonv1.GeneralMapItem{
						MapData: map[uint64]*commonv1.GeneralItem{c.ID: {Id: c.ID, Name: c.Name}},
					}},
				})
			case shipmentv1.ShipmentChannelByIdsDataType_SHIPMENT_CHANNEL_BY_IDS_DATA_TYPE_CHANNEL:
				slices = append(slices, &shipmentv1.ShipmentChannelByIdsResponseItem{
					D: &shipmentv1.ShipmentChannelByIdsResponseItem_Channel{Channel: &shipmentv1.ShipmentChannelRowMapItem{
						MapData: map[uint64]*shipmentv1.ShipmentChannel{c.ID: toProto(c)},
					}},
				})
			}
		}

		out[c.ID] = &shipmentv1.ShipmentChannelByIdsResponseList{Items: slices}
	}

	return out
}
