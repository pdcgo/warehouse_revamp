package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopByIds resolves shops by id ACROSS TEAMS (the-warehouse-row-fills-from-shop-and-user-by-ids): a warehouse ships
// other teams' orders, and its row names each order's shop and marketplace. Unscoped, like TeamByIds and UserByIDs.
//
// BASIC FIELDS ONLY — id, name, marketplace, owning team — never members, grants or settings. A DELETED shop is still
// returned, so an old order still names its shop; an id that never existed is absent. One query.
func (s *Service) ShopByIds(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopByIdsRequest],
) (*connect.Response[sellingv1.ShopByIdsResponse], error) {
	var rows []selling_service_models.Shop

	err := s.db.
		WithContext(ctx).
		Select("id", "team_id", "name", "marketplace").
		Where("id IN ?", req.Msg.GetFilter().GetIds()).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	general, basic := false, false

	for _, want := range req.Msg.GetDataRequest() {
		switch want {
		case sellingv1.ShopByIdsDataType_SHOP_BY_IDS_DATA_TYPE_GENERAL:
			general = true
		case sellingv1.ShopByIdsDataType_SHOP_BY_IDS_DATA_TYPE_BASIC:
			basic = true
		}
	}

	if !general && !basic {
		basic = true
	}

	// Keyed per id, each id's slices narrowed to its own shop, so a caller looks one shop up directly.
	items := make(map[uint64]*sellingv1.ShopByIdsResponseList, len(rows))

	for i := range rows {
		row := &rows[i]
		list := &sellingv1.ShopByIdsResponseList{}

		if general {
			list.Items = append(list.Items, &sellingv1.ShopByIdsResponseItem{
				D: &sellingv1.ShopByIdsResponseItem_General{
					General: &commonv1.GeneralMapItem{
						MapData: map[uint64]*commonv1.GeneralItem{row.ID: {Id: row.ID, Name: row.Name}},
					},
				},
			})
		}

		if basic {
			list.Items = append(list.Items, &sellingv1.ShopByIdsResponseItem{
				D: &sellingv1.ShopByIdsResponseItem_Basic{
					Basic: &sellingv1.ShopBasicMapItem{
						MapData: map[uint64]*sellingv1.ShopBasic{row.ID: {
							Id:          row.ID,
							TeamId:      row.TeamID,
							Name:        row.Name,
							Marketplace: san_marketplace.FromText(row.Marketplace),
						}},
					},
				},
			})
		}

		items[row.ID] = list
	}

	return connect.NewResponse(&sellingv1.ShopByIdsResponse{Items: items}), nil
}
