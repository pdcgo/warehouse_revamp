package liability_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// NewRegister mounts liability_service's Connect handlers under the shared interceptor chain and
// reports them for reflection.
//
// TWO of the contract's three services today: the read surface (#185) and the terms surface (#189).
// LiabilityPaymentService is declared in the same proto and is deliberately NOT mounted until #188
// implements it — that is the whole reason the contract is three services rather than one. Mounting a
// service means serving every one of its RPCs, so a single service would have forced stubs returning
// Unimplemented to be reachable, and reflection would advertise a contract this build cannot honour.
//
// ⚠ THE LEDGER'S WRITE PATH HAS NO WIRE SURFACE AT ALL, and that is not an omission. `PostEntry` is a
// domain function called in-process, because nothing outside this system may assert that one team
// owes another — every posting originates from a real event inside it.
func NewRegister(
	mux *http.ServeMux,
	liability *liability_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(liabilityv1connect.NewLiabilityServiceHandler(liability, opts))
		mux.Handle(liabilityv1connect.NewLiabilityTermsServiceHandler(liability, opts))
		mux.Handle(liabilityv1connect.NewLiabilityPaymentServiceHandler(liability, opts))

		return san_grpc.ServiceReflectNames{
			liabilityv1connect.LiabilityServiceName,
			liabilityv1connect.LiabilityTermsServiceName,
			liabilityv1connect.LiabilityPaymentServiceName,
		}
	}
}
