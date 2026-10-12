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

// NewRegister mounts selling_service's Connect handlers (ShopService + OrderService +
// OrderDraftService, all served by the one selling impl) under the shared interceptor chain and
// reports them for reflection.
func NewRegister(
	mux *http.ServeMux,
	selling *selling_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(sellingv1connect.NewShopServiceHandler(selling, opts))
		mux.Handle(sellingv1connect.NewOrderServiceHandler(selling, opts))
		mux.Handle(sellingv1connect.NewOrderDraftServiceHandler(selling, opts))

		// THE LISTENER — /event/<sub_id>/push. A plain HTTP route, not a Connect RPC, so the roling ACL does not
		// reach it: it is the broker's door, restricted at the ingress like the other listeners.
		mux.Handle("/event/"+MemberRemovedSubscription+"/push", event_source.NewMuxPushHandler(selling.MemberRemovedHandler()))

		return san_grpc.ServiceReflectNames{
			sellingv1connect.ShopServiceName,
			sellingv1connect.OrderServiceName,
			sellingv1connect.OrderDraftServiceName,
		}
	}
}
