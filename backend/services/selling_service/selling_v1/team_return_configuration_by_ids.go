package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// TeamReturnConfigurationByIds answers which of these teams have set a return warehouse — root's Teams list marks
// the selling teams that have not (root-sees-which-teams-have-no-return-warehouse). The ids are TEAM ids. A team
// with no row is ABSENT, and that absence is the answer the list reads. One query, on the unique team index.
func (s *Service) TeamReturnConfigurationByIds(
	ctx context.Context,
	req *connect.Request[sellingv1.TeamReturnConfigurationByIdsRequest],
) (*connect.Response[sellingv1.TeamReturnConfigurationByIdsResponse], error) {
	var rows []selling_service_models.TeamReturnConfiguration

	err := s.db.
		WithContext(ctx).
		Where("team_id IN ?", req.Msg.GetFilter().GetIds()).
		Find(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// CONFIGURATION is the only slice, and the default when none is asked for. Keyed per team id, each id's list
	// narrowed to its own row, so a caller looks one team up directly.
	items := make(map[uint64]*sellingv1.TeamReturnConfigurationByIdsResponseList, len(rows))

	for i := range rows {
		row := &rows[i]

		items[row.TeamID] = &sellingv1.TeamReturnConfigurationByIdsResponseList{
			Items: []*sellingv1.TeamReturnConfigurationByIdsResponseItem{{
				D: &sellingv1.TeamReturnConfigurationByIdsResponseItem_Configuration{
					Configuration: &sellingv1.TeamReturnConfigurationMapItem{
						MapData: map[uint64]*sellingv1.TeamReturnConfiguration{row.TeamID: returnConfigurationToProto(row)},
					},
				},
			}},
		}
	}

	return connect.NewResponse(&sellingv1.TeamReturnConfigurationByIdsResponse{Items: items}), nil
}
