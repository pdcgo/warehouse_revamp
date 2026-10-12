// Package san_grpc centralises how services mount themselves and how gRPC server reflection is
// advertised for exactly the services that were mounted.
//
// A service exposes one RegisterHandler. Calling it mounts that service's Connect handler(s) on the
// mux and returns the fully-qualified proto service names it exposed. The composition root collects
// those names and mounts reflection over precisely them — so a newly-added service cannot be
// mounted without also appearing in reflection, and reflection cannot advertise a service that was
// never mounted. The two stay in lockstep because they come from the same call.
package san_grpc

import (
	"net/http"

	"connectrpc.com/grpcreflect"
)

// ServiceReflectNames are the fully-qualified proto service names a RegisterHandler mounted — e.g.
// "warehouse.user.v1.UserService". protoc-gen-connect-go emits each as a `<Service>Name` constant,
// so a service reports `userv1connect.UserServiceName` rather than a hand-typed string.
type ServiceReflectNames []string

// RegisterHandler mounts a service's handler(s) and returns the reflection names it exposed. Each
// service provides one (see its register.go).
type RegisterHandler func() ServiceReflectNames

// Register runs every handler (mounting each service), then mounts gRPC server reflection over the
// union of the names they report. Both the v1 and v1alpha reflection APIs are mounted, because many
// clients (grpcurl included) still speak only the alpha one.
func Register(mux *http.ServeMux, handlers ...RegisterHandler) {
	var names ServiceReflectNames
	for _, register := range handlers {
		names = append(names, register()...)
	}

	reflector := grpcreflect.NewStaticReflector(names...)
	mux.Handle(grpcreflect.NewHandlerV1(reflector))
	mux.Handle(grpcreflect.NewHandlerV1Alpha(reflector))
}
