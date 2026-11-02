package user_v1

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
)

var errConnectionNameEmpty = errors.New("name the connection — for example, ChatGPT on your laptop")

// AgentConnect is the person ALLOWING an agent (an-agent-gets-its-own-team-credential): who may connect which team is
// checked here (the-owner-decides-who-connects-an-agent), a one-time code is minted for the grant, and the answer is
// the agent's registered redirect carrying it. The agent then trades the code for its own credential at the token
// endpoint — read-only, the team picked here, 90 days.
func (s *AgentService) AgentConnect(
	ctx context.Context,
	req *connect.Request[userv1.AgentConnectRequest],
) (*connect.Response[userv1.AgentConnectResponse], error) {
	msg := req.Msg

	userID, err := callerID(ctx)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(msg.GetName())
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errConnectionNameEmpty)
	}

	_, err = s.store.Client(ctx, msg.GetClientId(), msg.GetRedirectUri())
	if err != nil {
		return nil, clientError(err)
	}

	err = s.mayConnect(ctx, userID, msg.GetTeamId())
	if err != nil {
		return nil, err
	}

	code, err := s.store.MintCode(ctx, agent_credentials.CodeGrant{
		ClientID:      msg.GetClientId(),
		RedirectURI:   msg.GetRedirectUri(),
		CodeChallenge: msg.GetCodeChallenge(),
		UserID:        userID,
		TeamID:        msg.GetTeamId(),
		Name:          name,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	redirect, err := withQuery(msg.GetRedirectUri(), url.Values{"code": {code}, "state": {msg.GetState()}})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&userv1.AgentConnectResponse{RedirectUrl: redirect}), nil
}

// withQuery adds `values` to a registered redirect, keeping any query it already carries.
func withQuery(raw string, values url.Values) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}

	query := u.Query()

	for key, vs := range values {
		if key == "state" && vs[0] == "" {
			continue
		}

		query[key] = vs
	}

	u.RawQuery = query.Encode()

	return u.String(), nil
}
