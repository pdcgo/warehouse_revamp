package selling_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// TeamReturnConfigurationSet sets — or replaces — the scoped team's return warehouse. ONE statement, an
// INSERT … ON CONFLICT (team_id) DO UPDATE on the unique team index, so two managers saving at the same second
// leave one row holding the later warehouse, never two rows or a unique-violation error.
//
// Any warehouse is accepted (a-team-may-pick-any-return-warehouse): the server checks nothing about the pair.
func (s *Service) TeamReturnConfigurationSet(
	ctx context.Context,
	req *connect.Request[sellingv1.TeamReturnConfigurationSetRequest],
) (*connect.Response[sellingv1.TeamReturnConfigurationSetResponse], error) {
	now := time.Now()

	row := selling_service_models.TeamReturnConfiguration{
		TeamID:      req.Msg.GetTeamId(),
		WarehouseID: req.Msg.GetWarehouseId(),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	// RETURNING every column, so a replace hands back the row's ORIGINAL id and created_at, not the values
	// the INSERT would have written.
	err := s.db.
		WithContext(ctx).
		Clauses(
			clause.OnConflict{
				Columns: []clause.Column{{Name: "team_id"}},
				DoUpdates: clause.Assignments(map[string]any{
					"warehouse_id": row.WarehouseID,
					"updated_at":   now,
				}),
			},
			clause.Returning{},
		).
		Create(&row).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sellingv1.TeamReturnConfigurationSetResponse{
		Configuration: returnConfigurationToProto(&row),
	}), nil
}
