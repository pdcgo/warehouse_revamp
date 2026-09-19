package category_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1/categoryv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	category_v1 "github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_v1"
)

// NewRegister mounts category_service's Connect handler under the shared interceptor chain and
// reports it for reflection.
func NewRegister(
	mux *http.ServeMux,
	category *category_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(categoryv1connect.NewCategoryServiceHandler(category, opts))

		return san_grpc.ServiceReflectNames{categoryv1connect.CategoryServiceName}
	}
}
