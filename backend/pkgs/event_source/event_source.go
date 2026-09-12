// Package event_source publishes and receives domain events over Google Cloud Pub/Sub.
//
// Every event is a VARIANT of the one warehouse.events.v1.Event envelope, and each variant declares
// its own topic in the proto:
//
//	message OrderPlaced {
//	  option (event_config).topic = "order-placed";
//	  ...
//	}
//
// The topic therefore travels WITH the message. A publisher never names a topic, so it cannot
// publish to the wrong one, and the event↔topic mapping is readable from the .proto alone.
package event_source

import (
	"context"
	"errors"
	"fmt"
	"os"

	"cloud.google.com/go/pubsub/v2"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// defaultEmulatorHost is where `gcloud beta emulators pubsub` listens, and what
// docker-compose's `pubsub` profile publishes.
const defaultEmulatorHost = "localhost:8085"

// PushMessage is one Pub/Sub message as delivered to an HTTP *push* endpoint.
//
// Data is base64 in the wire JSON; encoding/json decodes that into []byte for us.
type PushMessage struct {
	Data        []byte            `json:"data"`
	Attributes  map[string]string `json:"attributes"`
	MessageID   string            `json:"messageId"`
	PublishTime string            `json:"publishTime"`
	OrderingKey string            `json:"orderingKey"`
}

// PushRequest mirrors the exact JSON shape Pub/Sub POSTs to a push endpoint.
type PushRequest struct {
	Message      PushMessage `json:"message"`
	Subscription string      `json:"subscription"`
}

// TopicName reads the topic declared by the variant SET on this envelope.
//
// The option lives on the variant, never on Event — one variant, one topic
// (one-event-one-topic-per-variant). So the envelope alone does not name a topic: the set variant
// does, and unwrapping the oneof is how the sender finds it.
//
// It returns an ERROR when nothing is set or the variant declares no topic, rather than an empty
// string that sails on and fails much later inside the Pub/Sub client with a far less obvious
// message. An event with no topic is a programming error, so it is said here.
//
// A validated Event always has a variant (the-event-oneof-is-required), so the unset case is only
// reachable by a caller that skipped validation.
func TopicName(event *eventsv1.Event) (string, error) {
	message := event.ProtoReflect()

	oneof := message.Descriptor().Oneofs().ByName("message")
	if oneof == nil {
		return "", fmt.Errorf("event_source: %s has no message oneof", message.Descriptor().FullName())
	}

	field := message.WhichOneof(oneof)
	if field == nil {
		return "", errors.New("event_source: event has no variant set, so it names no topic")
	}

	return VariantTopic(message.Get(field).Message().Interface())
}

// VariantTopic reads the topic one VARIANT declares. TopicName is what callers want — this is
// exported for the provisioning tool, which walks every variant to derive the set of topics to
// create without holding an envelope.
func VariantTopic(variant proto.Message) (string, error) {
	descriptor := variant.ProtoReflect().Descriptor()

	opts, ok := descriptor.Options().(*descriptorpb.MessageOptions)
	if !ok || opts == nil {
		return "", fmt.Errorf("event_source: %s declares no topic", descriptor.FullName())
	}

	if !proto.HasExtension(opts, eventsv1.E_EventConfig) {
		return "", fmt.Errorf("event_source: %s declares no topic", descriptor.FullName())
	}

	config, _ := proto.GetExtension(opts, eventsv1.E_EventConfig).(*eventsv1.EventConfig)

	topic := config.GetTopic()
	if topic == "" {
		return "", fmt.Errorf("event_source: %s has an empty topic", descriptor.FullName())
	}

	return topic, nil
}

// MessageAttributeCarrier adapts a Pub/Sub message's attributes to OpenTelemetry's
// TextMapCarrier, so a trace can be propagated across the queue.
type MessageAttributeCarrier map[string]string

func (c MessageAttributeCarrier) Get(key string) string {
	return c[key]
}

func (c MessageAttributeCarrier) Set(key string, value string) {
	c[key] = value
}

func (c MessageAttributeCarrier) Keys() []string {
	keys := make([]string, 0, len(c))

	for key := range c {
		keys = append(keys, key)
	}

	return keys
}

// NewPubsubEmulator connects to a local Pub/Sub emulator (docker-compose `pubsub` profile).
// The host comes from PUBSUB_EMULATOR_HOST, defaulting to localhost:8085.
func NewPubsubEmulator(ctx context.Context, projectID string) (*pubsub.Client, error) {
	host := os.Getenv("PUBSUB_EMULATOR_HOST")
	if host == "" {
		host = defaultEmulatorHost
	}

	conn, err := grpc.NewClient(host, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}

	return pubsub.NewClient(ctx, projectID, option.WithGRPCConn(conn))
}

// NewPubsubClient connects to real Pub/Sub using ambient credentials.
func NewPubsubClient(ctx context.Context, projectID string) (*pubsub.Client, error) {
	if projectID == "" {
		projectID = os.Getenv("GOOGLE_CLOUD_PROJECT")
	}

	if projectID == "" {
		return nil, fmt.Errorf("event_source: no project id (set GOOGLE_CLOUD_PROJECT)")
	}

	return pubsub.NewClient(ctx, projectID)
}

// errCloneFailed cannot happen — proto.Clone of a *T returns a *T — but the type assertion has to be
// checked, and a panic in a publisher is worse than an error.
var errCloneFailed = errors.New("event_source: cloning the event failed")
