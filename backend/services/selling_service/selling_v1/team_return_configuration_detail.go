package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// TeamReturnConfigurationDetail returns the scoped team's return warehouse. A team that has not set one is
// an ABSENT configuration, not NotFound: "not set" is a normal state of a team — the one the settings screen
// asks to fix — not a missing record.
func (s *Service) TeamReturnConfigurationDetail(
	ctx context.Context,
	req *connect.Request[sellingv1.TeamReturnConfigurationDetailRequest],
) (*connect.Response[sellingv1.TeamReturnConfigurationDetailResponse], error) {
	var rows []selling_service_models.TeamReturnConfiguration

	// Find, not First: a team with no row is a normal answer, not ErrRecordNotFound.
	err := s.db.
		WithContext(ctx).
		Where("team_id = ?", req.Msg.GetTeamId()).
		Limit(1).
		Find(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	res := &sellingv1.TeamReturnConfigurationDetailResponse{}
	if len(rows) > 0 {
		res.Configuration = returnConfigurationToProto(&rows[0])
	}

	return connect.NewResponse(res), nil
}

func returnConfigurationToProto(row *selling_service_models.TeamReturnConfiguration) *sellingv1.TeamReturnConfiguration {
	return &sellingv1.TeamReturnConfiguration{
		TeamId:        row.TeamID,
		WarehouseId:   row.WarehouseID,
		UpdatedAtUnix: row.UpdatedAt.Unix(),
	}
}
