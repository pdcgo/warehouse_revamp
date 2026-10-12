package region_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1/regionv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	region_v1 "github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_v1"
)

// NewRegister mounts region_service's Connect handler under the shared interceptor chain and
// reports it for reflection.
//
// It takes the same `opts` as every other service even though its RPCs are unscoped: the chain also
// carries protovalidate, and `allow_only_authenticated` still has to be ENFORCED — an unscoped
// policy is not an unguarded one.
func NewRegister(
	mux *http.ServeMux,
	region *region_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(regionv1connect.NewRegionServiceHandler(region, opts))

		return san_grpc.ServiceReflectNames{
			regionv1connect.RegionServiceName,
		}
	}
}
