package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// AgentConnectionRevoke ends one of MY connections — at once: the next call the agent makes is refused. It signs the
// person out of nothing else (an-agent-gets-its-own-team-credential). Somebody else's connection is NotFound.
func (s *AgentService) AgentConnectionRevoke(
	ctx context.Context,
	req *connect.Request[userv1.AgentConnectionRevokeRequest],
) (*connect.Response[userv1.AgentConnectionRevokeResponse], error) {
	userID, err := callerID(ctx)
	if err != nil {
		return nil, err
	}

	err = s.revoke(ctx, s.liveConnections(ctx).Where("id = ? AND user_id = ?", req.Msg.GetConnectionId(), userID))
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&userv1.AgentConnectionRevokeResponse{}), nil
}
