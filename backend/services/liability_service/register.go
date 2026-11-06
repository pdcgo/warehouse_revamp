package liability_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
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

		// THE COURIER'S CHARGE WEBHOOK — /event/<sub_id>/push, a plain HTTP route like supplier's fold, so the roling
		// ACL does not reach it (the-event-webhook-is-open). ⚠ Unlike a fold, what it writes is a DEBT, so a forged
		// event here is worth more than a skewed figure: restrict this path at the ingress to Pub/Sub's push.
		push := event_source.NewMuxPushHandler(NewLiabilityPushHandler(liability))
		// THE ORDER'S FEES — charged on *Order Placed*, reversed on *Order Cancelled* (#186,
		// the-event-carries-the-warehouse-fee). `san pubsub ensure` declares both subscriptions; without these routes the
		// emulator's pushes 404'd and dead-lettered, so no order fee ever reached Team Balance (found 2026-11-06).
		mux.Handle("/event/"+OrderPlacedSubscription+"/push", push)
		mux.Handle("/event/"+OrderCancelledSubscription+"/push", push)
		mux.Handle("/event/"+RestockAcceptedSubscription+"/push", push)
		// …and the courier's charge at a RETURN's door — the same handler, its own subscription
		// (a-return-may-carry-the-couriers-ask). The same ingress restriction applies.
		mux.Handle("/event/"+OrderReturnAcceptedSubscription+"/push", push)
		// …and at a TRANSFER's receiving door — a `transfer_fee` keyed by the transfer
		// (a-transfer-charge-is-a-transfer-fee). The same ingress restriction applies.
		mux.Handle("/event/"+WarehouseTransferAcceptedSubscription+"/push", push)

		return san_grpc.ServiceReflectNames{
			liabilityv1connect.LiabilityServiceName,
			liabilityv1connect.LiabilityTermsServiceName,
			liabilityv1connect.LiabilityPaymentServiceName,
		}
	}
}
