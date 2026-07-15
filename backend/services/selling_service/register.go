package selling_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// NewRegister mounts selling_service's Connect handlers (ShopService + OrderService, both served by
// the one selling impl) under the shared interceptor chain and reports them for reflection.
func NewRegister(
	mux *http.ServeMux,
	selling *selling_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(sellingv1connect.NewShopServiceHandler(selling, opts))
		mux.Handle(sellingv1connect.NewOrderServiceHandler(selling, opts))

		return san_grpc.ServiceReflectNames{
			sellingv1connect.ShopServiceName,
			sellingv1connect.OrderServiceName,
		}
	}
}
