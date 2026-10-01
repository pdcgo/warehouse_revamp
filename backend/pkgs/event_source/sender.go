package event_source

import (
	"context"
	"time"

	"buf.build/go/protovalidate"
	"cloud.google.com/go/pubsub/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
)

// publishTimeout bounds the wait, matching the Pub/Sub client's own DefaultPublishSettings.Timeout —
// "the maximum time the client will attempt to publish a bundle". Waiting longer than the client will
// try achieves nothing.
const publishTimeout = 60 * time.Second

// metaKeyEventType is the one key the LIBRARY writes into Event.metadata. A subscription filter can
// only match attributes, and the metadata map is copied verbatim into them
// (event-metadata-is-copied-into-the-attributes), so this is how a consumer filters to the variants it
// handles.
//
// The caller and the library share this map's key namespace: a producer must not set this key, or the
// filter matches whatever was written last.
const metaKeyEventType = "event_type"

// EventSender publishes one event.
//
// nil means the BROKER STORED IT — not that it was handed to the client. Under
// no-outbox-the-publish-is-trusted this return value is the whole delivery guarantee, so it waits for
// the server's acknowledgement rather than returning as soon as the message is queued.
//
// The IDENTITY IS A PARAMETER, not something read out of ctx (identity-is-a-sender-parameter). A ctx
// value is invisible in a signature, so a call site that lost it would compile and publish an event
// saying nobody caused it. A parameter cannot be omitted.
//
// Use SystemIdentity when there is no caller — a pull worker, a push handler, tools/san, a backfill.
// san_auth.GetIdentity ERRORS outside a request rather than returning nil, so passing its error
// through would make every event published outside an HTTP request fail.
//
// It is a func type, not an interface, so a service can be handed EmptySender in tests without a
// Pub/Sub client anywhere in sight.
type EventSender func(ctx context.Context, identity *role_basev1.Identity, event *eventsv1.Event) error

// SystemIdentity is what a caller with no authenticated user passes.
//
// The agent is REQUIRED and not defaulted on purpose: "the system did it" is the easy thing to reach
// for, and a call site inside a real request that reaches for it anyway loses the user with nothing to
// detect it. SystemIdentity("settlement-backfill") reads as a deliberate statement.
func SystemIdentity(agent string) *role_basev1.Identity {
	return &role_basev1.Identity{
		IdentityType: role_basev1.IdentityType_IDENTITY_TYPE_SYSTEM,
		Agent:        agent,
	}
}

// EmptySender validates the event and drops it. For tests, and for local runs with no Pub/Sub —
// validation still happens, so a malformed event is still caught.
func EmptySender(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	return protovalidate.GlobalValidator.Validate(event)
}

// NewPubsubEventSender publishes to the topic the SET VARIANT declares (see TopicName).
//
// The client is handed in and never closed here: stopping publishers and closing the client at
// shutdown are the SERVICE's (publisher-and-client-shutdown-is-the-services). A service that wants a
// deploy to close cleanly sets its shutdown grace to at least publishTimeout, because a send still
// being retried when the process exits is lost with no log line.
func NewPubsubEventSender(client *pubsub.Client) EventSender {
	return func(ctx context.Context, identity *role_basev1.Identity, event *eventsv1.Event) error {
		// Copy before writing, so the caller's event comes back exactly as it went in. The sender adds
		// the identity, event_type and the trace context — mutating in place would hand the caller an
		// event carrying fields it never set, and make a re-send accumulate them.
		outgoing, ok := proto.Clone(event).(*eventsv1.Event)
		if !ok {
			return errCloneFailed
		}

		outgoing.Identity = withoutTokenExpiry(identity)

		topicName, err := TopicName(outgoing)
		if err != nil {
			return err
		}

		// ONE MAP, written to both places (event-metadata-is-copied-into-the-attributes): the metadata
		// travels in the body AND is the message's attributes, so a subscription filter and a handler
		// read the same keys.
		//
		// Pub/Sub caps attributes at 100 keys, a 256-byte key and a 1024-byte value where the proto map
		// has no cap — Event.metadata carries buf.validate rules mirroring exactly those limits, so the
		// validation below rejects anything the broker would have, with an error naming the field.
		if outgoing.Metadata == nil {
			outgoing.Metadata = map[string]string{}
		}

		variantName := setVariantName(outgoing)
		outgoing.Metadata[metaKeyEventType] = variantName

		otel.GetTextMapPropagator().Inject(ctx, MessageAttributeCarrier(outgoing.Metadata))

		err = protovalidate.GlobalValidator.Validate(outgoing)
		if err != nil {
			return err
		}

		span := trace.SpanFromContext(ctx)
		span.SetAttributes(
			attribute.String("event.name", variantName),
			attribute.String("event.topic", topicName),
			attribute.String("event.id", outgoing.GetEventId()),
		)

		data, err := protojson.Marshal(outgoing)
		if err != nil {
			return err
		}

		result := client.Publisher(topicName).Publish(ctx, &pubsub.Message{
			Data:       data,
			Attributes: outgoing.Metadata,
		})

		// The client SENDS on its own background context, so cancelling ctx only abandons the WAIT —
		// the message may still be delivered. Waiting on a detached ctx (sender-ctx-carries-values-not-cancel)
		// makes the return value mean what it says: the caller's cancellation no longer turns a
		// successful publish into an error.
		waitCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), publishTimeout)
		defer cancel()

		// Publish is async — Get blocks until the server acknowledges. Without it a caller could return
		// "sent" for an event the broker never accepted.
		_, err = result.Get(waitCtx)

		// The client's error, as it is (sender-returns-the-client-error-as-is). No sentinel, no wrapping:
		// what the caller does with it is the caller's, and the adopter rule is that a send error after
		// the commit is logged with its event_id and never fails the request.
		return err
	}
}

// withoutTokenExpiry copies the identity with expired_at cleared.
//
// The identity is a RECORD of who caused the event, and it outlives the token it came from. Left on,
// a consumer that checks it rejects every replayed event as expired — and the field means nothing on a
// fact that already happened. agent, agent_version and username stay: username is deliberately a
// SNAPSHOT of who they were then, not a lookup that changes when they are renamed.
func withoutTokenExpiry(identity *role_basev1.Identity) *role_basev1.Identity {
	if identity == nil {
		return nil
	}

	copied, ok := proto.Clone(identity).(*role_basev1.Identity)
	if !ok {
		return nil
	}

	copied.ExpiredAt = nil

	return copied
}

// setVariantName is the full proto name of the variant set on the envelope, or "" when none is —
// which validation then rejects (the-event-oneof-is-required).
func setVariantName(event *eventsv1.Event) string {
	message := event.ProtoReflect()

	oneof := message.Descriptor().Oneofs().ByName("message")
	if oneof == nil {
		return ""
	}

	field := message.WhichOneof(oneof)
	if field == nil {
		return ""
	}

	return string(field.Message().FullName())
}
