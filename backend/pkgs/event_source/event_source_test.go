package event_source

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
)

// validEvent is an envelope that passes validation: the three typed fields the library reads, and one
// variant set.
func validEvent() *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     "order-placed:7",
		OccurredAt:  timestamppb.New(time.Unix(1_700_000_000, 0)),
		AggregateId: "order:7",
		Message: &eventsv1.Event_OrderPlaced{
			OrderPlaced: &eventsv1.OrderPlaced{TeamId: 1, OrderId: 7},
		},
	}
}

// The topic comes off the SET VARIANT's option, not from the caller and not from the envelope — the
// envelope declares none.
func TestTopicName(t *testing.T) {
	topic, err := TopicName(validEvent())
	if err != nil {
		t.Fatalf("TopicName: %v", err)
	}

	if topic != "order-placed" {
		t.Errorf("topic = %q, want %q", topic, "order-placed")
	}
}

// A different variant means a different topic, read from the same envelope type. This is what
// one-event-one-topic-per-variant buys: the publisher never names a topic.
func TestTopicNamePerVariant(t *testing.T) {
	event := validEvent()
	event.Message = &eventsv1.Event_OrderCancelled{
		OrderCancelled: &eventsv1.OrderCancelled{TeamId: 1, OrderId: 7},
	}

	topic, err := TopicName(event)
	if err != nil {
		t.Fatalf("TopicName: %v", err)
	}

	if topic != "order-cancelled" {
		t.Errorf("topic = %q, want %q", topic, "order-cancelled")
	}
}

// An envelope with no variant names no topic, and must say so loudly rather than returning "" and
// failing later inside the Pub/Sub client.
func TestTopicNameNoVariant(t *testing.T) {
	_, err := TopicName(&eventsv1.Event{EventId: "x"})
	if err == nil {
		t.Fatal("want an error for an event with no variant set, got nil")
	}

	if !strings.Contains(err.Error(), "no variant") {
		t.Errorf("error should name the problem, got: %v", err)
	}
}

func TestEmptySenderValidates(t *testing.T) {
	err := EmptySender(context.Background(), SystemIdentity("test"), validEvent())
	if err != nil {
		t.Fatalf("EmptySender: %v", err)
	}
}

// the-event-oneof-is-required, proved at the SEND end: a producer that forgot to set a variant is
// stopped here, so an empty envelope never enters the system.
func TestEmptySenderRejectsUnsetOneof(t *testing.T) {
	event := validEvent()
	event.Message = nil

	err := EmptySender(context.Background(), SystemIdentity("test"), event)
	if err == nil {
		t.Fatal("an Event with no variant must fail validation, got nil")
	}
}

// SystemIdentity is what a caller with no authenticated user passes — a positive statement, not an
// absence, so "nobody" and "this call site lost the user" do not read the same.
func TestSystemIdentity(t *testing.T) {
	identity := SystemIdentity("tools/san")

	if identity.GetIdentityType() != role_basev1.IdentityType_IDENTITY_TYPE_SYSTEM {
		t.Errorf("identity_type = %v, want SYSTEM", identity.GetIdentityType())
	}

	if identity.GetAgent() != "tools/san" {
		t.Errorf("agent = %q, want tools/san", identity.GetAgent())
	}
}

// The token's expiry is a token's, and the event outlives it. Left on, a consumer that checks it
// rejects every replayed event as expired.
func TestWithoutTokenExpiry(t *testing.T) {
	identity := &role_basev1.Identity{
		IdentityId: 57,
		Username:   "ani",
		ExpiredAt:  timestamppb.New(time.Unix(1_700_000_000, 0)),
	}

	cleaned := withoutTokenExpiry(identity)

	if cleaned.GetExpiredAt() != nil {
		t.Error("expired_at must be cleared before the identity goes on an event")
	}

	if cleaned.GetIdentityId() != 57 || cleaned.GetUsername() != "ani" {
		t.Error("everything but the expiry must survive — username is a snapshot of who they were")
	}

	if identity.GetExpiredAt() == nil {
		t.Error("the CALLER's identity must not be mutated")
	}
}

func TestMessageAttributeCarrier(t *testing.T) {
	carrier := MessageAttributeCarrier{}
	carrier.Set("traceparent", "abc")

	if carrier.Get("traceparent") != "abc" {
		t.Errorf("Get = %q, want abc", carrier.Get("traceparent"))
	}

	keys := carrier.Keys()
	if len(keys) != 1 || keys[0] != "traceparent" {
		t.Errorf("Keys = %v, want [traceparent]", keys)
	}
}

// pushBody builds the exact JSON Pub/Sub POSTs to a push endpoint.
func pushBody(t *testing.T, event *eventsv1.Event) string {
	t.Helper()

	data, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	body, err := json.Marshal(PushRequest{
		// The FULL path, exactly as a real push sends it. A handler matching short subscription
		// constants would fall to its default branch on this and ACK everything, which is why
		// dispatch is on the variant instead.
		Subscription: "projects/p/subscriptions/liability-order-placed",
		Message: PushMessage{
			Data:      data, // encoding/json base64-encodes []byte, exactly like Pub/Sub
			MessageID: "123",
		},
	})
	if err != nil {
		t.Fatalf("marshal push: %v", err)
	}

	return string(body)
}

func TestPushHandlerAcks(t *testing.T) {
	var got *eventsv1.Event

	handler := NewMuxPushHandler(func(_ context.Context, event *eventsv1.Event) error {
		got = event

		return nil
	})

	req := httptest.NewRequest(http.MethodPost, "/event/liability-order-placed/push",
		strings.NewReader(pushBody(t, validEvent())))
	res := httptest.NewRecorder()

	handler(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (a 2xx is the ACK)", res.Code)
	}

	if got.GetOrderPlaced().GetOrderId() != 7 {
		t.Fatalf("handler received %v, want the OrderPlaced variant for order 7", got)
	}
}

// A failing handler must NOT ACK — Pub/Sub redelivers only on a non-2xx.
func TestPushHandlerNacksOnError(t *testing.T) {
	handler := NewMuxPushHandler(func(_ context.Context, _ *eventsv1.Event) error {
		return errors.New("boom")
	})

	req := httptest.NewRequest(http.MethodPost, "/event/liability-order-placed/push",
		strings.NewReader(pushBody(t, validEvent())))
	res := httptest.NewRecorder()

	handler(res, req)

	if res.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", res.Code)
	}
}

func TestPushHandlerRejectsGarbage(t *testing.T) {
	called := false

	handler := NewMuxPushHandler(func(_ context.Context, _ *eventsv1.Event) error {
		called = true

		return nil
	})

	req := httptest.NewRequest(http.MethodPost, "/event/x/push", strings.NewReader("{not json"))
	res := httptest.NewRecorder()

	handler(res, req)

	if res.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", res.Code)
	}

	if called {
		t.Error("handler ran on an undecodable body")
	}
}

// the-event-oneof-is-required, proved at the RECEIVE end and this is the case it exists for: under
// DiscardUnknown, an arm this build does not know is DROPPED, leaving a valid-looking envelope with no
// body. Without the required rule the handler would be called with nothing to dispatch on and the
// message would be silently ACKed.
func TestPushHandlerRejectsUnknownVariant(t *testing.T) {
	called := false

	handler := NewMuxPushHandler(func(_ context.Context, _ *eventsv1.Event) error {
		called = true

		return nil
	})

	// An envelope whose only variant is one this build has never heard of — exactly what a consumer
	// that has not regenerated receives after a producer adds an arm.
	body, err := json.Marshal(PushRequest{
		Subscription: "projects/p/subscriptions/s",
		Message: PushMessage{
			MessageID: "123",
			Data: []byte(`{"eventId":"x:1","occurredAt":"2023-11-14T22:13:20Z",` +
				`"aggregateId":"x:1","stockMovedInSomeFutureBuild":{"id":1}}`),
		},
	})
	if err != nil {
		t.Fatalf("marshal push: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/event/x/push", strings.NewReader(string(body)))
	res := httptest.NewRecorder()

	handler(res, req)

	if called {
		t.Fatal("an envelope with no variant reached the handler — it has nothing to dispatch on")
	}

	if res.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", res.Code)
	}
}
