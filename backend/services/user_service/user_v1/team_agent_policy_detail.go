package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// TeamAgentPolicyDetail is whether the team's CS and staff may connect an agent — off until its owner turns it on
// (the-owner-decides-who-connects-an-agent).
func (s *AgentService) TeamAgentPolicyDetail(
	ctx context.Context,
	req *connect.Request[userv1.TeamAgentPolicyDetailRequest],
) (*connect.Response[userv1.TeamAgentPolicyDetailResponse], error) {
	allowed, err := s.membersMayConnect(ctx, req.Msg.GetTeamId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.TeamAgentPolicyDetailResponse{MembersMayConnect: allowed}), nil
}
