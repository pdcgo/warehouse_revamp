package main

import (
	"context"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	liability_service "github.com/pdcgo/warehouse_revamp/backend/services/liability_service"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// NewEventSender provides the EventSender the services publish through (#153).
//
// THE DEV SERVER HAS NO BROKER, and running one to place an order would make `docker compose up -d`
// insufficient to work on this app. So the development composition root wires a LOOPBACK: an event is
// marshalled exactly as Pub/Sub would carry it, wrapped in the same PushRequest shape, and handed to
// the same push handler the real subscription would deliver it to.
//
// What that does and does not buy, stated plainly:
//
//   - It exercises the CONTRACT and the HANDLER — the parts with logic. The event is really
//     serialised, really decoded, really dispatched by subscription name, and really recorded. A field
//     that does not survive protojson, or a handler that mis-maps one, fails here.
//   - It does NOT exercise the BROKER — no retries, no redelivery, no dead-lettering, and it is
//     synchronous where production is not. Anything that depends on those has to be reasoned about,
//     or tested against the emulator (`docker compose --profile pubsub up -d`).
//
// The synchronous part is safe only because the publisher ignores publish errors by design: a consumer
// failure must not fail the order. If a caller ever starts depending on the returned error, this
// loopback would couple an order's fate to its consumers' — which is exactly what the event was chosen
// to avoid.
func NewEventSender(
	liabilityService *liability_v1.Service,
) event_source.EventSender {
	liabilityHandler := liability_service.NewLiabilityPushHandler(liabilityService)

	// Which subscriptions each event is delivered to. In production this mapping lives in Pub/Sub's
	// topic→subscription configuration; here it has to be stated, because there is no Pub/Sub.
	//
	// ⚠ A TOPIC FANS OUT TO SEVERAL SUBSCRIPTIONS (#186), and this list must model that even while only
	// ONE consumer is left. `liability_service` is currently the only subscriber to the two order
	// events — `revenue_service` was the other and has been removed — but the shape stays a fan-out
	// list, because a loopback that assumes one handler per topic silently drops the second the day one
	// is added back. The order events keep being PUBLISHED regardless of who listens (see
	// order_place.go): that is what makes a statistics consumer re-addable later without touching
	// selling_service.
	deliveries := []struct {
		topic        string
		subscription string
		handler      event_source.PushHandler
	}{
		{"order-placed", liability_service.OrderPlacedSubscription, liabilityHandler},
		{"order-cancelled", liability_service.OrderCancelledSubscription, liabilityHandler},
	}

	return func(ctx context.Context, event proto.Message) (string, error) {
		// Validate first, exactly as both real senders do — so a malformed event is caught in dev too.
		_, err := event_source.EmptySender(ctx, event)
		if err != nil {
			return "", err
		}

		topic, err := event_source.TopicName(event)
		if err != nil {
			return "", err
		}

		data, err := protojson.Marshal(event)
		if err != nil {
			return "", err
		}

		// Delivered to EVERY subscription on this topic. A topic with no subscriptions is published
		// and dropped, which is what production would do too.
		//
		// The first failure stops the fan-out and is returned, which is the honest shape here: the
		// loopback is synchronous and has no per-subscription retry, so pretending a failed delivery
		// succeeded would hide a broken consumer during exactly the work that is most likely to break
		// one. Callers already ignore publish errors by design, so this still cannot fail an order.
		for _, delivery := range deliveries {
			if delivery.topic != topic {
				continue
			}

			err = delivery.handler(ctx, &event_source.PushRequest{
				Subscription: delivery.subscription,
				Message: event_source.PushMessage{
					// A stable, meaningless id: the loopback delivers once, so nothing keys off it.
					// It is populated rather than left empty only so log lines have something to
					// print.
					MessageID: "loopback",
					Data:      data,
				},
			})
			if err != nil {
				return "", err
			}
		}

		return "", nil
	}
}
