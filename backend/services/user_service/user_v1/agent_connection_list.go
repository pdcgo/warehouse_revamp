package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// AgentConnectionList is MY live connections — /profile's AI agents, newest first. Revoked and expired ones read
// nothing, so they are not listed.
func (s *AgentService) AgentConnectionList(
	ctx context.Context,
	req *connect.Request[userv1.AgentConnectionListRequest],
) (*connect.Response[userv1.AgentConnectionListResponse], error) {
	userID, err := callerID(ctx)
	if err != nil {
		return nil, err
	}

	items, ids, info, err := s.connectionPage(
		s.liveConnections(ctx).Where("user_id = ?", userID),
		req.Msg.GetPage(),
		req.Msg.GetDataRequest(),
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.AgentConnectionListResponse{Items: items, Ids: ids, PageInfo: info}), nil
}
