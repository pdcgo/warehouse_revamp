// Package event_source publishes and receives domain events over Google Cloud Pub/Sub.
//
// An event declares its own topic in the proto:
//
//	message OrderCreatedEvent {
//	  option (warehouse.event_base.v1.event_config).event_topic = "order-created";
//	  ...
//	}
//
// The topic therefore travels WITH the message. A publisher never names a topic, so it cannot
// publish to the wrong one, and the event↔topic mapping is readable from the .proto alone.
package event_source

import (
	"context"
	"fmt"
	"os"

	"cloud.google.com/go/pubsub/v2"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"

	event_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/event_base/v1"
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

// TopicName reads the topic an event declared via (warehouse.event_base.v1.event_config).
//
// It returns an ERROR when the event declares no topic. (The original returned an empty
// string, which sails on and fails much later inside the Pub/Sub client with a far less
// obvious message — an event with no topic is a programming error, so say so here.)
func TopicName(event proto.Message) (string, error) {
	descriptor := event.ProtoReflect().Descriptor()

	opts, ok := descriptor.Options().(*descriptorpb.MessageOptions)
	if !ok || opts == nil {
		return "", fmt.Errorf("event_source: %s declares no event_topic", descriptor.FullName())
	}

	if !proto.HasExtension(opts, event_basev1.E_EventConfig) {
		return "", fmt.Errorf("event_source: %s declares no event_topic", descriptor.FullName())
	}

	config, _ := proto.GetExtension(opts, event_basev1.E_EventConfig).(*event_basev1.MessageEventConfig)

	topic := config.GetEventTopic()
	if topic == "" {
		return "", fmt.Errorf("event_source: %s has an empty event_topic", descriptor.FullName())
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
