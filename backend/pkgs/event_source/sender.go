package event_source

import (
	"context"

	"buf.build/go/protovalidate"
	"cloud.google.com/go/pubsub/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// EventSender publishes one event and returns the server-assigned message id.
//
// It is a func type, not an interface, so a service can be handed EmptySender in tests
// without a Pub/Sub client anywhere in sight.
type EventSender func(ctx context.Context, event proto.Message) (string, error)

// EmptySender validates the event and drops it. For tests, and for local runs with no
// Pub/Sub — validation still happens, so a malformed event is still caught.
func EmptySender(_ context.Context, event proto.Message) (string, error) {
	err := protovalidate.GlobalValidator.Validate(event)
	if err != nil {
		return "", err
	}

	return "", nil
}

// NewPubsubEventSender publishes to the topic the event itself declares (see TopicName), and
// propagates the current trace into the message attributes so a consumer's span links back to
// the publisher's.
func NewPubsubEventSender(client *pubsub.Client) EventSender {
	return func(ctx context.Context, event proto.Message) (string, error) {
		err := protovalidate.GlobalValidator.Validate(event)
		if err != nil {
			return "", err
		}

		topicName, err := TopicName(event)
		if err != nil {
			return "", err
		}

		eventName := string(event.ProtoReflect().Descriptor().FullName())

		span := trace.SpanFromContext(ctx)
		span.SetAttributes(
			attribute.String("event.name", eventName),
			attribute.String("event.topic", topicName),
		)

		data, err := protojson.Marshal(event)
		if err != nil {
			return "", err
		}

		attributes := MessageAttributeCarrier{}
		otel.GetTextMapPropagator().Inject(ctx, attributes)

		result := client.Publisher(topicName).Publish(ctx, &pubsub.Message{
			Data:       data,
			Attributes: attributes,
		})

		// Publish is async; Get blocks until the server acknowledges. Without it a caller
		// could return "sent" for an event the broker never accepted.
		serverID, err := result.Get(ctx)
		if err != nil {
			return "", err
		}

		return serverID, nil
	}
}
