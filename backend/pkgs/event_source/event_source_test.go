package event_source

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"

	event_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/event_base/v1"
)

// The topic must come off the message option, not from the caller.
func TestTopicName(t *testing.T) {
	topic, err := TopicName(&event_basev1.HelloExampleEvent{Name: "x"})
	if err != nil {
		t.Fatalf("TopicName: %v", err)
	}

	if topic != "hello-topic" {
		t.Errorf("topic = %q, want %q", topic, "hello-topic")
	}
}

// An event with no event_topic is a programming error and must say so loudly, rather than
// returning "" and failing later inside the Pub/Sub client.
func TestTopicNameMissing(t *testing.T) {
	_, err := TopicName(&event_basev1.MessageEventConfig{})
	if err == nil {
		t.Fatal("want an error for a message with no event_topic, got nil")
	}

	if !strings.Contains(err.Error(), "event_topic") {
		t.Errorf("error should name the problem, got: %v", err)
	}
}

func TestEmptySenderValidates(t *testing.T) {
	id, err := EmptySender(context.Background(), &event_basev1.HelloExampleEvent{Name: "x"})
	if err != nil {
		t.Fatalf("EmptySender: %v", err)
	}

	if id != "" {
		t.Errorf("EmptySender returned a message id %q — it must not pretend to publish", id)
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
func pushBody(t *testing.T, event *event_basev1.HelloExampleEvent) string {
	t.Helper()

	data, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	body, err := json.Marshal(PushRequest{
		Subscription: "projects/p/subscriptions/s",
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
	var got *event_basev1.HelloExampleEvent

	handler := NewMuxPushHandler(func(_ context.Context, msg *PushRequest) error {
		event := &event_basev1.HelloExampleEvent{}

		err := DecodeEvent(msg, event)
		if err != nil {
			return err
		}

		got = event

		return nil
	})

	body := pushBody(t, &event_basev1.HelloExampleEvent{Name: "warehouse"})
	req := httptest.NewRequest(http.MethodPost, "/events/hello", strings.NewReader(body))
	res := httptest.NewRecorder()

	handler(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (a 2xx is the ACK)", res.Code)
	}

	if got == nil || got.GetName() != "warehouse" {
		t.Fatalf("handler received %v, want name=warehouse", got)
	}
}

// A failing handler must NOT ACK — Pub/Sub redelivers only on a non-2xx.
func TestPushHandlerNacksOnError(t *testing.T) {
	handler := NewMuxPushHandler(func(_ context.Context, _ *PushRequest) error {
		return errors.New("boom")
	})

	body := pushBody(t, &event_basev1.HelloExampleEvent{Name: "x"})
	req := httptest.NewRequest(http.MethodPost, "/events/hello", strings.NewReader(body))
	res := httptest.NewRecorder()

	handler(res, req)

	if res.Code == http.StatusOK {
		t.Fatal("handler errored but returned 200 — the message would be ACKed and lost")
	}

	if res.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", res.Code)
	}
}

func TestPushHandlerRejectsGarbage(t *testing.T) {
	called := false

	handler := NewMuxPushHandler(func(_ context.Context, _ *PushRequest) error {
		called = true

		return nil
	})

	req := httptest.NewRequest(http.MethodPost, "/events/hello", strings.NewReader("{not json"))
	res := httptest.NewRecorder()

	handler(res, req)

	if res.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", res.Code)
	}

	if called {
		t.Error("handler ran on an undecodable body")
	}
}
