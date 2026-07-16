package inventory_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// NewRegister mounts inventory_service's Connect handler under the shared interceptor chain and
// reports it for reflection.
func NewRegister(
	mux *http.ServeMux,
	inventory *inventory_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(inventoryv1connect.NewInventoryServiceHandler(inventory, opts))

		// Pub/Sub PUSH receiver (#102) — a plain HTTP endpoint (not a Connect RPC), so it is mounted
		// directly rather than through san_grpc. Push auth (OIDC/token) is a deployment concern.
		mux.Handle("/events/inventory", event_source.NewMuxPushHandler(NewInventoryPushHandler()))

		return san_grpc.ServiceReflectNames{inventoryv1connect.InventoryServiceName}
	}
}
