package selling_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// NewRegister mounts selling_service's Connect handler under the shared interceptor chain and
// reports it for reflection.
func NewRegister(
	mux *http.ServeMux,
	shop *selling_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(sellingv1connect.NewShopServiceHandler(shop, opts))

		return san_grpc.ServiceReflectNames{sellingv1connect.ShopServiceName}
	}
}
