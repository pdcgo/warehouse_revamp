package warehouse_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1/warehousev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// NewRegister mounts warehouse_service's WarehouseFeeService under the shared interceptor chain and reports it for
// reflection.
func NewRegister(
	mux *http.ServeMux,
	warehouse *warehouse_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(warehousev1connect.NewWarehouseFeeServiceHandler(warehouse, opts))

		return san_grpc.ServiceReflectNames{
			warehousev1connect.WarehouseFeeServiceName,
		}
	}
}
