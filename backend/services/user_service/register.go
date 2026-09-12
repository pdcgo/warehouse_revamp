package user_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// NewRegister mounts user_service's two Connect handlers under the shared interceptor chain —
// AuthService (login/logout/token checks) and UserService (user & membership administration) — and
// reports both for reflection. Keeping the mount and the reflection names in one place means adding
// a third handler here can't silently skip either.
func NewRegister(
	mux *http.ServeMux,
	auth *user_v1.AuthService,
	users *user_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(userv1connect.NewAuthServiceHandler(auth, opts))
		mux.Handle(userv1connect.NewUserServiceHandler(users, opts))

		return san_grpc.ServiceReflectNames{
			userv1connect.AuthServiceName,
			userv1connect.UserServiceName,
		}
	}
}
