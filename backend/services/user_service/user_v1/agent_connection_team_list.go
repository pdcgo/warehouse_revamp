package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// AgentConnectionTeamList is every live connection reading the team, whoever made it — its owner's view
// (the-owner-decides-who-connects-an-agent). Root's every-team connections are not the team's, and are not listed.
func (s *AgentService) AgentConnectionTeamList(
	ctx context.Context,
	req *connect.Request[userv1.AgentConnectionTeamListRequest],
) (*connect.Response[userv1.AgentConnectionTeamListResponse], error) {
	items, ids, info, err := s.connectionPage(
		s.liveConnections(ctx).Where("team_id = ?", req.Msg.GetTeamId()),
		req.Msg.GetPage(),
		req.Msg.GetDataRequest(),
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.AgentConnectionTeamListResponse{Items: items, Ids: ids, PageInfo: info}), nil
}
