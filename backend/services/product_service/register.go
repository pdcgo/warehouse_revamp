package product_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1/productv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// NewRegister mounts product_service's Connect handler under the shared interceptor chain and
// reports it for reflection.
func NewRegister(
	mux *http.ServeMux,
	product *product_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(productv1connect.NewProductServiceHandler(product, opts))

		return san_grpc.ServiceReflectNames{productv1connect.ProductServiceName}
	}
}
