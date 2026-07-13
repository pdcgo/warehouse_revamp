package event_source

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// PushHandler consumes one pushed message. Returning nil ACKs it; returning an error NACKs it
// and Pub/Sub will redeliver.
type PushHandler func(ctx context.Context, msg *PushRequest) error

// DecodeEvent unmarshals a pushed message into a typed event.
//
//	event := &sellingv1.OrderCreatedEvent{}
//	err := event_source.DecodeEvent(msg, event)
func DecodeEvent(msg *PushRequest, event proto.Message) error {
	return protojson.Unmarshal(msg.Message.Data, event)
}

// NewMuxPushHandler adapts a PushHandler to an http.HandlerFunc for a Pub/Sub PUSH
// subscription, continuing the publisher's trace from the message attributes.
//
// ACK semantics — Pub/Sub treats ANY non-2xx as a NACK and redelivers:
//   - handler returns nil  -> 200, message ACKed.
//   - handler returns err  -> 500, message redelivered.
//   - undecodable body     -> 400, message redelivered.
//
// That last one matters: a permanently malformed message is redelivered FOREVER. The
// subscription must therefore have a dead-letter policy — this handler cannot distinguish
// "poison" from "transient", and silently ACKing bad payloads would lose them instead.
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

		// Continue the publisher's trace rather than starting an orphan one.
		carrier := MessageAttributeCarrier(msg.Message.Attributes)
		ctx := otel.GetTextMapPropagator().Extract(r.Context(), carrier)

		ctx, span := otel.Tracer("").Start(ctx, r.URL.Path)
		defer span.End()

		span.SetAttributes(
			attribute.String("event.path", r.URL.Path),
			attribute.String("event.message_id", msg.Message.MessageID),
		)

		err = handler(ctx, &msg)
		if err != nil {
			http.Error(w, "cannot handle event "+err.Error(), http.StatusInternalServerError)

			slog.Error("push error",
				slog.String("path", r.URL.Path),
				slog.String("message_id", msg.Message.MessageID),
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
