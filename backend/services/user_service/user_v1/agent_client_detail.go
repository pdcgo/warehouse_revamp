package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
)

// AgentClientDetail names the agent asking to connect — the connect page's "ChatGPT wants to read …" — and confirms the
// redirect is one the agent registered, before the page sends the browser anywhere, even to say no.
func (s *AgentService) AgentClientDetail(
	ctx context.Context,
	req *connect.Request[userv1.AgentClientDetailRequest],
) (*connect.Response[userv1.AgentClientDetailResponse], error) {
	client, err := s.store.Client(ctx, req.Msg.GetClientId(), req.Msg.GetRedirectUri())
	if err != nil {
		return nil, clientError(err)
	}

	return connect.NewResponse(&userv1.AgentClientDetailResponse{ClientName: client.ClientName}), nil
}

// clientError maps the store's client refusals: an unknown agent is NotFound, a redirect it never registered is
// InvalidArgument.
func clientError(err error) error {
	switch {
	case errors.Is(err, agent_credentials.ErrUnknownClient):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, agent_credentials.ErrBadRedirect):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
