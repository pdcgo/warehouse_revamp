package event_source

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"buf.build/go/protovalidate"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/encoding/protojson"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// PushHandler consumes one DECODED event. Returning nil ACKs it, returning an error NACKs it and
// Pub/Sub redelivers.
//
// It takes the whole envelope and dispatches on the VARIANT, never on the subscription name: a real
// push carries the full subscription path ("projects/…/subscriptions/…"), so a handler matching short
// constants falls to its default branch on every message and ACKs them all.
//
// One event, not a slice (handlers-take-one-event-not-a-batch). The handler opens its own transaction
// and claims event_id inside it — the library has no transaction to hand over.
type PushHandler func(ctx context.Context, event *eventsv1.Event) error

// decodeEvent turns a pushed body into a validated envelope.
//
// DiscardUnknown is deliberate: it is what lets a producer ADD a field without breaking a consumer
// that has not regenerated yet (the-library-has-one-decoder). What makes that leniency safe is
// validation — the oneof is REQUIRED (the-event-oneof-is-required), so an arm this build does not know
// is dropped, leaves the oneof unset and FAILS here, instead of arriving as a valid Event with no body
// and being silently accepted.
func decodeEvent(data []byte) (*eventsv1.Event, error) {
	event := &eventsv1.Event{}

	options := protojson.UnmarshalOptions{DiscardUnknown: true}

	err := options.Unmarshal(data, event)
	if err != nil {
		return nil, err
	}

	err = protovalidate.GlobalValidator.Validate(event)
	if err != nil {
		return nil, err
	}

	return event, nil
}

// NewMuxPushHandler adapts a PushHandler to an http.HandlerFunc for a Pub/Sub PUSH subscription,
// continuing the publisher's trace from the message attributes.
//
// ACK semantics — Pub/Sub treats ANY non-2xx as a NACK and redelivers:
//   - handler returns nil    -> 200, message ACKed.
//   - handler returns err    -> 500, message redelivered.
//   - undecodable or invalid -> 400, message redelivered.
//
// That last one matters: a permanently malformed message is redelivered FOREVER. The subscription must
// therefore have a dead-letter policy, which the provisioning function always sets
// (setup-ensures-safe-defaults-never-deletes).
//
// ⚠ The decided end state is RECORD-then-ACK for an undecodable message rather than a NACK
// (reject-never-nacks) — a row a human can read, instead of a message circling until it dead-letters.
// That needs the rejection store, which arrives with the receive path in san_event. Until then this
// keeps the existing behaviour rather than ACKing something nothing has written down.
func NewMuxPushHandler(handler PushHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "cannot read request body", http.StatusBadRequest)

			return
		}

		msg := PushRequest{}

		err = json.Unmarshal(body, &msg)
		if err != nil {
			http.Error(w, "cannot decode push request", http.StatusBadRequest)

			return
		}

		// Continue the publisher's trace rather than starting an orphan one. Read from the ATTRIBUTES,
		// before anything is decoded, so a message that fails to decode still lands in the right trace.
		carrier := MessageAttributeCarrier(msg.Message.Attributes)
		ctx := otel.GetTextMapPropagator().Extract(r.Context(), carrier)

		ctx, span := otel.Tracer("").Start(ctx, r.URL.Path)
		defer span.End()

		span.SetAttributes(
			attribute.String("event.path", r.URL.Path),
			attribute.String("event.message_id", msg.Message.MessageID),
		)

		event, err := decodeEvent(msg.Message.Data)
		if err != nil {
			span.RecordError(err, trace.WithAttributes(
				attribute.String("event.payload", string(msg.Message.Data)),
			))

			slog.ErrorContext(ctx, "push event could not be decoded",
				slog.String("path", r.URL.Path),
				slog.String("message_id", msg.Message.MessageID),
				slog.String("err", err.Error()),
			)

			http.Error(w, "cannot decode event", http.StatusBadRequest)

			return
		}

		span.SetAttributes(attribute.String("event.id", event.GetEventId()))

		err = handler(ctx, event)
		if err != nil {
			http.Error(w, "cannot handle event "+err.Error(), http.StatusInternalServerError)

			slog.Error("push error",
				slog.String("path", r.URL.Path),
				slog.String("message_id", msg.Message.MessageID),
				slog.String("event_id", event.GetEventId()),
				slog.String("err", err.Error()),
			)

			span.RecordError(err, trace.WithStackTrace(true), trace.WithAttributes(
				attribute.String("event.payload", string(body)),
			))
			span.SetStatus(codes.Error, err.Error())

			return
		}

		// ACK by returning 2xx.
		w.WriteHeader(http.StatusOK)
	}
}
