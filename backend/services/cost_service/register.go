package cost_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/cost/v1/costv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/backend/services/cost_service/cost_v1"
)

// NewRegister mounts CostService and returns the proto service names it exposes, so mounting and
// gRPC reflection come from the same call and cannot drift apart.
func NewRegister(
	mux *http.ServeMux,
	cost *cost_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(costv1connect.NewCostServiceHandler(cost, opts))

		return san_grpc.ServiceReflectNames{
			costv1connect.CostServiceName,
		}
	}
}
