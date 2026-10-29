package selling_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// MemberRemovedSubscription is the push subscription that tells the shops a person left a team
// (removing-a-member-drops-their-shop-access). Declared beside the route that serves it
// (one-adopter-checklist-for-both-drivers); tools/san's `pubsub ensure` declares the same id, with a filter on
// event_type — a subscription's filter is IMMUTABLE, so it has to be right at creation.
const MemberRemovedSubscription = "selling-member-removed"

// The order metrics' fold reads three topics, so it has three push subscriptions — a subscription reads one topic —
// all served by the one FoldHandler (a-report-is-fed-by-events-only-for-now). tools/san's `pubsub ensure` declares the
// same ids, each filtered to its event_type.
const (
	OrderFoldPlacedSubscription    = "selling-order-fold-placed"
	OrderFoldCancelledSubscription = "selling-order-fold-cancelled"
	OrderFoldMovedSubscription     = "selling-order-fold-moved"
)

// NewRegister mounts selling_service's Connect handlers (ShopService + OrderService +
// OrderDraftService + TeamReturnConfigurationService, all served by the one selling impl, and OrderAnalyticService,
// served by the order metrics' own) under the shared interceptor chain and reports them for reflection.
func NewRegister(
	mux *http.ServeMux,
	selling *selling_v1.Service,
	analytic *selling_v1.Analytic,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(sellingv1connect.NewShopServiceHandler(selling, opts))
		mux.Handle(sellingv1connect.NewOrderServiceHandler(selling, opts))
		mux.Handle(sellingv1connect.NewOrderDraftServiceHandler(selling, opts))
		mux.Handle(sellingv1connect.NewTeamReturnConfigurationServiceHandler(selling, opts))
		mux.Handle(sellingv1connect.NewOrderAnalyticServiceHandler(analytic, opts))

		// THE LISTENER — /event/<sub_id>/push. A plain HTTP route, not a Connect RPC, so the roling ACL does not
		// reach it: it is the broker's door, restricted at the ingress like the other listeners.
		mux.Handle("/event/"+MemberRemovedSubscription+"/push", event_source.NewMuxPushHandler(selling.MemberRemovedHandler()))

		// THE ORDER METRICS' FOLD — the same handler behind each topic's subscription. ⚠ It authenticates nobody, as
		// supplier's fold does not (the-event-webhook-is-open): restrict the paths at the ingress.
		fold := event_source.NewMuxPushHandler(analytic.FoldHandler())
		mux.Handle("/event/"+OrderFoldPlacedSubscription+"/push", fold)
		mux.Handle("/event/"+OrderFoldCancelledSubscription+"/push", fold)
		mux.Handle("/event/"+OrderFoldMovedSubscription+"/push", fold)

		return san_grpc.ServiceReflectNames{
			sellingv1connect.ShopServiceName,
			sellingv1connect.OrderServiceName,
			sellingv1connect.OrderDraftServiceName,
			sellingv1connect.TeamReturnConfigurationServiceName,
			sellingv1connect.OrderAnalyticServiceName,
		}
	}
}
