package user_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// NewRegister mounts user_service's Connect handlers under the shared interceptor chain —
// AuthService (login/logout/token checks), UserService (user & membership administration) and AgentService (the AI
// agents a person connects, our-server-hosts-the-mcp) — and reports them for reflection. Keeping the mount and the
// reflection names in one place means adding a handler here can't silently skip either.
func NewRegister(
	mux *http.ServeMux,
	auth *user_v1.AuthService,
	users *user_v1.Service,
	agents *user_v1.AgentService,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(userv1connect.NewAuthServiceHandler(auth, opts))
		mux.Handle(userv1connect.NewUserServiceHandler(users, opts))
		mux.Handle(userv1connect.NewAgentServiceHandler(agents, opts))

		return san_grpc.ServiceReflectNames{
			userv1connect.AuthServiceName,
			userv1connect.UserServiceName,
			userv1connect.AgentServiceName,
		}
	}
}
