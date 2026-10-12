package remote

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1/remotev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
)

// NewRegister mounts the handler and reports it for gRPC reflection — the same shape every
// warehouse service uses, so `grpcurl` works against this server without anything special.
//
// The interceptors come from the CALLER, not from here, so the auth interceptor cannot be
// forgotten in one place and applied in another: there is exactly one mount, in serve.
func NewRegister(
	mux *http.ServeMux,
	service *Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(remotev1connect.NewRemoteServiceHandler(service, opts))

		return san_grpc.ServiceReflectNames{remotev1connect.RemoteServiceName}
	}
}
