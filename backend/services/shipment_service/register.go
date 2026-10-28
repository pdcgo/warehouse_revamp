package shipment_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1/shipmentv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
)

// receiptReadMaxBytes caps what ReceiptService reads (receipt-check-caps-the-body-before-reading). The
// FILE is held to 2 MB by the request's own `max_len` — the reader's cap — but that is checked only once
// the body has been read; the browser sends JSON, where 2 MB of bytes is ~2.7 MB of base64, so the
// transport's cap sits just above that, and nothing larger is read at all.
//
// ⚠ ON THIS HANDLER ONLY. The channel handlers keep connect's default: their requests are a few ids.
const receiptReadMaxBytes = 3 << 20

// NewRegister mounts shipment_service's Connect handlers (ShipmentChannelService + ReceiptService, both
// served by the one shipment impl) under the shared interceptor chain and reports them for reflection.
func NewRegister(
	mux *http.ServeMux,
	shipment *shipment_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(shipmentv1connect.NewShipmentChannelServiceHandler(shipment, opts))
		mux.Handle(shipmentv1connect.NewReceiptServiceHandler(
			shipment,
			opts,
			connect.WithReadMaxBytes(receiptReadMaxBytes),
		))

		return san_grpc.ServiceReflectNames{
			shipmentv1connect.ShipmentChannelServiceName,
			shipmentv1connect.ReceiptServiceName,
		}
	}
}
