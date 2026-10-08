package supplier_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// FoldSubscription is the push subscription that feeds a supplier's figures — `RestockAccepted`, folded by
// supplier_service's own webhook (the-report-is-processed-like-settlement).
//
// Declared beside the route that serves it. tools/san's `pubsub ensure` declares the same id, with a filter on
// event_type — a subscription's filter is IMMUTABLE, so it has to be right at creation.
const FoldSubscription = "supplier-fold"

// NewRegister mounts supplier_service's Connect handlers under the shared interceptor chain, mounts the fold's push
// route, and reports the Connect services for reflection.
//
// ALL FOUR proto services are mounted, because all four are complete — a service is mounted WHOLE.
func NewRegister(
	mux *http.ServeMux,
	supplier *supplier_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(supplierv1connect.NewSupplierServiceHandler(supplier, opts))
		mux.Handle(supplierv1connect.NewSupplierChannelServiceHandler(supplier, opts))
		mux.Handle(supplierv1connect.NewSupplierAnalyticServiceHandler(supplier, opts))
		mux.Handle(supplierv1connect.NewSupplierAnalyticMaintenanceServiceHandler(supplier, opts))

		// THE WEBHOOK — /event/<sub_id>/push. A plain HTTP route, not a Connect RPC, so the roling ACL does not reach
		// it. ⚠ It authenticates nobody, as settlement's does not (the-event-webhook-is-open): a forged event can only
		// corrupt a projection AnalyticReplayCompute rebuilds. Restrict the path at the ingress.
		mux.Handle("/event/"+FoldSubscription+"/push", event_source.NewMuxPushHandler(supplier.FoldHandler()))

		return san_grpc.ServiceReflectNames{
			supplierv1connect.SupplierServiceName,
			supplierv1connect.SupplierChannelServiceName,
			supplierv1connect.SupplierAnalyticServiceName,
			supplierv1connect.SupplierAnalyticMaintenanceServiceName,
		}
	}
}
