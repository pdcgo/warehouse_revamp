// Package san_event provides the interfaces a service implements to RECEIVE and DEDUP events.
// Nothing else.
//
// How a service then PROCESSES those events — batch, streaming, whatever fits — is the service's own
// scope, along with its tables, migrations, retention, position tracking, rebuild and reconcile. This
// package has no opinion and no machinery there.
//
// The authoritative design is guidelines/architectures/event_library.md; the pipeline rules that make
// a thin library safe are in guidelines/architectures/data_pipeline.md; the authoring rules no tool
// can enforce are in guidelines/event-guideline.md.
//
// ⚠ Do NOT take design from disscuss/ — that folder is where architecture is argued out and nothing
// in it is settled (CLAUDE.md HARD RULE 7).
//
// Transport stays in pkgs/event_source — clients, topics, subscriptions, push/pull drivers. This
// package's inbound edge is IncomingMessage, the normalised form a driver produces.
package san_event

import "google.golang.org/protobuf/proto"

// Event is every event message in this system. The two getters come free from protoc-gen-go — adding
// the proto fields IS the whole implementation:
//
//	string event_id         = 98 [(buf.validate.field).string.min_len = 1];
//	int64  occurred_at_unix = 99 [(buf.validate.field).int64.gt = 0];
//
// Taking Event rather than proto.Message is what makes a missing field a COMPILE error. The interface
// proves the field exists; buf.validate proves it is filled. Both are needed — see
// guidelines/event-guideline.md, which carries the rules no tool can enforce.
//
// ⚠ There is deliberately NO setter. If anything could stamp occurred_at_unix onto an empty event,
// "must be filled" would be decorative, and a default turns a loud failure into a silent wrong day at
// month end. Only the publisher writes these.
type Event interface {
	proto.Message

	// GetEventId is the LOGICAL id — the dedup key, and never the transport's message id.
	//
	// ⚠ It must be DERIVED from the row that caused the event ("stock-moved:8241"), never a fresh
	// UUID. A redelivery and a replay are the same logical fact and must collide, which is the exact
	// case dedup exists for.
	GetEventId() string

	// GetOccurredAtUnix is when the fact HAPPENED, from one authoritative clock — not the publish
	// time, not the retry time. Consumers bucket by it, so two clocks for one fact would file a
	// boundary row in different days depending on who read it.
	//
	// It stays a timestamp, not a date: which day it belongs to is the consumer's decision, and a
	// stored date would freeze that choice into every event ever published.
	GetOccurredAtUnix() int64
}

// newMessage allocates an empty T.
//
// The zero value of T is a typed nil pointer (*OrderPlacedEvent)(nil), and protoc-gen-go's
// ProtoReflect is nil-safe by construction — it resolves the message type from the file descriptor
// rather than from the receiver — so New() on it yields a fresh, non-nil message of that type.
//
// This is what lets Unmarshal and Register be generic over T without a registry lookup: the concrete
// type is known at the call site, so nothing resolves through protoregistry and dynamicpb never
// appears.
func newMessage[T Event]() T {
	var zero T

	return zero.ProtoReflect().New().Interface().(T)
}
