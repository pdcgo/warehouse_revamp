package revenue_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1/revenuev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
)

// NewRegister mounts RevenueService and returns the proto service names it exposes, so mounting and
// gRPC reflection come from the same call and cannot drift apart.
func NewRegister(
	mux *http.ServeMux,
	revenue *revenue_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(revenuev1connect.NewRevenueServiceHandler(revenue, opts))

		return san_grpc.ServiceReflectNames{
			revenuev1connect.RevenueServiceName,
		}
	}
}
