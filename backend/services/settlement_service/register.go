package settlement_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1/settlementv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// FoldSubscription is the push subscription that feeds settlement's reports — `SettlementLogPosted`,
// folded by settlement's own webhook (#the-fold-owns-the-report-not-the-writer).
//
// Declared beside the route that serves it (one-adopter-checklist-for-both-drivers). tools/san's
// `pubsub ensure` declares the same id, with a filter on event_type — a subscription's filter is
// IMMUTABLE, so it has to be right at creation.
const FoldSubscription = "settlement-fold"

// The push subscriptions that open and cancel an order's account (settlement-opens-the-sale-from-the-order-event):
// settlement's OWN subscriptions on the order's topics, beside liability's on the same ones, so each consumer
// keeps its own delivery state. `pubsub ensure` declares the same ids, each filtered on event_type.
const (
	OrderPlacedSubscription    = "settlement-order-placed"
	OrderCancelledSubscription = "settlement-order-cancelled"
)

// NewRegister mounts settlement_service's Connect handlers under the shared interceptor chain, mounts
// the fold's push route, and reports the Connect services for reflection.
//
// ALL FOUR proto services are mounted, because all four are complete — a service is mounted WHOLE, so
// one with a missing RPC would advertise a contract this build cannot honour.
func NewRegister(
	mux *http.ServeMux,
	settlement *settlement_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(settlementv1connect.NewSettlementServiceHandler(settlement, opts))
		mux.Handle(settlementv1connect.NewSettlementWriteServiceHandler(settlement, opts))
		mux.Handle(settlementv1connect.NewSettlementAnalyticServiceHandler(settlement, opts))
		mux.Handle(settlementv1connect.NewSettlementAnalyticMaintenanceServiceHandler(settlement, opts))

		// THE WEBHOOK — /event/<sub_id>/push (analytic_context.md §Webhook). A plain HTTP route, not a
		// Connect RPC, so it is mounted directly and the roling ACL does not reach it. ⚠ It authenticates
		// nobody, by decision (#the-event-webhook-is-open): a forged event can only corrupt a projection
		// AnalyticReplayCompute rebuilds, never the ledger. Restrict the path at the ingress.
		mux.Handle("/event/"+FoldSubscription+"/push", event_source.NewMuxPushHandler(settlement.FoldHandler()))
		// The order's account, opened and cancelled from the order's own events — one handler, switching on
		// the variant, behind both routes (the same rule liability's handler follows).
		sale := event_source.NewMuxPushHandler(settlement.OrderSaleHandler())
		mux.Handle("/event/"+OrderPlacedSubscription+"/push", sale)
		mux.Handle("/event/"+OrderCancelledSubscription+"/push", sale)

		return san_grpc.ServiceReflectNames{
			settlementv1connect.SettlementServiceName,
			settlementv1connect.SettlementWriteServiceName,
			settlementv1connect.SettlementAnalyticServiceName,
			settlementv1connect.SettlementAnalyticMaintenanceServiceName,
		}
	}
}
