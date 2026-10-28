package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ProductReturnMapByIds answers which of these borrowed products the scoped team has already mapped for returns, and to
// which of its own products — the order form pre-fills those rows and locks them (a-return-map-is-written-once). The ids
// are BORROWED product ids. A product the team has not mapped is ABSENT, and that absence is the row the form asks
// about.
//
// The team is the filter as well as the scope: another team's map of the same borrowed product is that team's answer,
// and never this one's. One query, on the unique (team_id, shared_product_id) index; bounded by the 1–100 ids.
func (s *Service) ProductReturnMapByIds(
	ctx context.Context,
	req *connect.Request[sellingv1.ProductReturnMapByIdsRequest],
) (*connect.Response[sellingv1.ProductReturnMapByIdsResponse], error) {
	var rows []selling_service_models.ProductReturnMap

	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND shared_product_id IN ?", req.Msg.GetTeamId(), req.Msg.GetFilter().GetIds()).
		Find(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// PAIR is the only slice, and the default when none is asked for. Keyed per borrowed product, each id's list
	// narrowed to its own pair, so a caller looks one product up directly.
	items := make(map[uint64]*sellingv1.ProductReturnMapByIdsResponseList, len(rows))

	for i := range rows {
		row := &rows[i]

		items[row.SharedProductID] = &sellingv1.ProductReturnMapByIdsResponseList{
			Items: []*sellingv1.ProductReturnMapByIdsResponseItem{{
				D: &sellingv1.ProductReturnMapByIdsResponseItem_Pair{
					Pair: &sellingv1.ProductReturnMapPairItem{
						MapData: map[uint64]*sellingv1.ProductReturnMap{row.SharedProductID: productReturnMapToProto(row)},
					},
				},
			}},
		}
	}

	return connect.NewResponse(&sellingv1.ProductReturnMapByIdsResponse{Items: items}), nil
}
