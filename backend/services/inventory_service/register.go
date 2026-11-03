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
		mux.Handle(inventoryv1connect.NewRestockRequestServiceHandler(inventory, opts))
		mux.Handle(inventoryv1connect.NewRackServiceHandler(inventory, opts))
		// An order's take and its release, on the decided ledgers — called by the order service while it creates or
		// cancels an order (order_transaction_create.go, order_transaction_release.go).
		mux.Handle(inventoryv1connect.NewOrderTransactionServiceHandler(inventory, opts))
		// A selling team moving its own stock from one warehouse to another, on the decided ledgers (warehouse_transfer_*.go).
		mux.Handle(inventoryv1connect.NewWarehouseTransferServiceHandler(inventory, opts))
		// The stock count — a session that snapshots and locks the shelf book, counts blind and finalizes into the
		// stock-problem register (opname_*.go).
		mux.Handle(inventoryv1connect.NewOpnameServiceHandler(inventory, opts))
		// A found at the shelf waiting for the warehouse Owner or Admin — reported, listed, approved, rejected, settled by
		// a count (found_request_*.go, an-adjust-found-waits-for-the-owner-or-admin).
		mux.Handle(inventoryv1connect.NewFoundRequestServiceHandler(inventory, opts))

		// Pub/Sub PUSH receiver (#102) — a plain HTTP endpoint (not a Connect RPC), so it is mounted
		// directly rather than through san_grpc. Push auth (OIDC/token) is a deployment concern.
		mux.Handle("/events/inventory", event_source.NewMuxPushHandler(NewInventoryPushHandler()))

		return san_grpc.ServiceReflectNames{
			inventoryv1connect.InventoryServiceName,
			inventoryv1connect.RestockRequestServiceName,
			inventoryv1connect.RackServiceName,
			inventoryv1connect.OrderTransactionServiceName,
			inventoryv1connect.WarehouseTransferServiceName,
			inventoryv1connect.OpnameServiceName,
			inventoryv1connect.FoundRequestServiceName,
		}
	}
}
