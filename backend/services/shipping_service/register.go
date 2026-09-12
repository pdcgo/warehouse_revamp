package shipping_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1/shippingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	shipping_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_v1"
)

// NewRegister mounts shipping_service's Connect handler under the shared interceptor chain and
// reports it for reflection.
func NewRegister(
	mux *http.ServeMux,
	shipping *shipping_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(shippingv1connect.NewShippingServiceHandler(shipping, opts))

		return san_grpc.ServiceReflectNames{shippingv1connect.ShippingServiceName}
	}
}
