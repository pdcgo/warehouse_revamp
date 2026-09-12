package settlement_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1/settlementv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// NewRegister mounts settlement_service's Connect handlers under the shared interceptor chain and
// reports them for reflection.
//
// BOTH proto services are mounted, because both are complete. That is the difference from
// liability_service, which deliberately withheld one: a service is mounted WHOLE — the generated
// handler interface demands every RPC and mounting also puts it in reflection — so a service with a
// missing RPC would advertise a contract this build cannot honour.
func NewRegister(
	mux *http.ServeMux,
	settlement *settlement_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(settlementv1connect.NewSettlementServiceHandler(settlement, opts))
		mux.Handle(settlementv1connect.NewSettlementWriteServiceHandler(settlement, opts))

		return san_grpc.ServiceReflectNames{
			settlementv1connect.SettlementServiceName,
			settlementv1connect.SettlementWriteServiceName,
		}
	}
}
