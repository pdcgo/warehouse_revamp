package user_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm/clause"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// TeamAgentPolicySet is the OWNER turning on — or off — whether CS and staff may connect an agent
// (the-owner-decides-who-connects-an-agent). One upsert on the team's row. Turning it off connects nothing new and
// leaves the connections already made: each is revoked on its own, from the team's list.
func (s *AgentService) TeamAgentPolicySet(
	ctx context.Context,
	req *connect.Request[userv1.TeamAgentPolicySetRequest],
) (*connect.Response[userv1.TeamAgentPolicySetResponse], error) {
	userID, err := callerID(ctx)
	if err != nil {
		return nil, err
	}

	row := user_service_models.TeamAgentPolicy{
		TeamID:            req.Msg.GetTeamId(),
		MembersMayConnect: req.Msg.GetMembersMayConnect(),
		UpdatedByUserID:   &userID,
		UpdatedAt:         s.now(),
		IsOverride:        san_auth.IsOverride(ctx),
	}

	err = s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "team_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"members_may_connect", "updated_by_user_id", "updated_at", "is_override"}),
		}).
		Create(&row).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.TeamAgentPolicySetResponse{MembersMayConnect: row.MembersMayConnect}), nil
}
