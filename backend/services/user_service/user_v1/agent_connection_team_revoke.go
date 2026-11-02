package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// AgentConnectionTeamRevoke is the OWNER ending any connection reading the team — a member's too
// (the-owner-decides-who-connects-an-agent). One reading another team, or every team, is NotFound.
func (s *AgentService) AgentConnectionTeamRevoke(
	ctx context.Context,
	req *connect.Request[userv1.AgentConnectionTeamRevokeRequest],
) (*connect.Response[userv1.AgentConnectionTeamRevokeResponse], error) {
	err := s.revoke(ctx, s.liveConnections(ctx).Where("id = ? AND team_id = ?", req.Msg.GetConnectionId(), req.Msg.GetTeamId()))
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&userv1.AgentConnectionTeamRevokeResponse{}), nil
}
