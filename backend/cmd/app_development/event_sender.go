package main

import (
	"context"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	revenue_service "github.com/pdcgo/warehouse_revamp/backend/services/revenue_service"
	revenue_v1 "github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
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
// The synchronous part is safe only because the publisher ignores publish errors by design: a revenue
// failure must not fail the order. If a caller ever starts depending on the returned error, this
// loopback would couple an order's fate to revenue's — which is exactly what the event was chosen to
// avoid.
func NewEventSender(revenueService *revenue_v1.Service) event_source.EventSender {
	handler := revenue_service.NewRevenuePushHandler(revenueService)

	// Which subscription each event is delivered to. In production this mapping lives in Pub/Sub's
	// topic→subscription configuration; here it has to be stated, because there is no Pub/Sub.
	subscriptionFor := map[string]string{
		"order-placed": revenue_service.OrderPlacedSubscription,
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

		subscription, wanted := subscriptionFor[topic]
		if !wanted {
			// Nothing consumes this topic locally. Published and dropped, like a topic with no
			// subscriptions — which is what production would do too.
			return "", nil
		}

		data, err := protojson.Marshal(event)
		if err != nil {
			return "", err
		}

		return "", handler(ctx, &event_source.PushRequest{
			Subscription: subscription,
			Message: event_source.PushMessage{
				// A stable, meaningless id: the loopback delivers once, so nothing keys off it. It is
				// populated rather than left empty only so log lines have something to print.
				MessageID: "loopback",
				Data:      data,
			},
		})
	}
}
