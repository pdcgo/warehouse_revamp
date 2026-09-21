package shipment_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1/shipmentv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
)

// NewRegister mounts shipment_service's Connect handler under the shared interceptor chain and reports
// it for reflection.
func NewRegister(
	mux *http.ServeMux,
	shipment *shipment_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(shipmentv1connect.NewShipmentChannelServiceHandler(shipment, opts))

		return san_grpc.ServiceReflectNames{shipmentv1connect.ShipmentChannelServiceName}
	}
}
