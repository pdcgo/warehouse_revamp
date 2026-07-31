package san_event

import (
	"errors"
	"fmt"

	"buf.build/go/protovalidate"
	"google.golang.org/protobuf/encoding/protojson"
)

// The two failure modes of a read, kept distinguishable because the receiver classifies a rejection by
// them (Undecodable vs Invalid) and a human reading the rejection log needs to know which happened.
var (
	// ErrDecode — the bytes are not this message type at all.
	ErrDecode = errors.New("san_event: cannot decode event")

	// ErrValidate — the bytes decoded, but the event does not satisfy its buf.validate rules.
	ErrValidate = errors.New("san_event: event failed validation")
)

// Marshal encodes an event for the wire.
//
// THE FORMAT IS protojson, AND IT IS PERMANENT. There is no format tag on the payload, so changing this
// would strand every stored row and require a rewriting migration per service (see
// guidelines/architectures/event_library.md, "No format tag").
//
// It beat binary proto on LEGIBILITY, not size — binary wins size 3-5x, and that loss is real once a
// service retains events for years. But the whole failure story in this design ends with a human reading
// a payload: a RejectHandler row, a dead-letter message, a log line. protojson is readable in the Pub/Sub
// console with no tooling and no message type to hand. A service that retains events long-term and finds
// the size hurts can re-encode IN ITS OWN TABLE — storage is its scope. The wire has to stay legible.
func Marshal(e Event) ([]byte, error) {
	data, err := protojson.Marshal(e)
	if err != nil {
		return nil, fmt.Errorf("san_event: cannot marshal %T: %w", e, err)
	}

	return data, nil
}

// Unmarshal decodes bytes into T and validates the result. Services read events through this and never
// through protojson directly, so one place decides the format, the decode options, and that validation
// happens — twelve services cannot drift apart, and NOTHING DOWNSTREAM CAN EVER HOLD AN INVALID EVENT,
// on the receive path or on a replay.
//
// DiscardUnknown is deliberate: it is what lets a publisher ADD a field without breaking a consumer that
// has not regenerated yet. The cost is that it is permissive — a payload of the WRONG TYPE on a
// subscription decodes into a mostly-empty message instead of failing. Strict decoding would catch that
// for free; validation is what catches it instead, because event_id comes back empty and
// occurred_at_unix zero. The two live in one function precisely so nobody can tune one of them apart
// from the other.
//
// ⚠ Because this validates on every READ, validation rules may only ever LOOSEN. Tighten one and every
// stored event that no longer passes becomes UNREADABLE — discovered mid-rebuild, in production. That
// rule is in guidelines/event-guideline.md, and buf breaking cannot see a violation of it.
func Unmarshal[T Event](data []byte) (T, error) {
	var zero T

	event := newMessage[T]()

	options := protojson.UnmarshalOptions{DiscardUnknown: true}

	err := options.Unmarshal(data, event)
	if err != nil {
		return zero, fmt.Errorf("%w into %T: %w", ErrDecode, event, err)
	}

	err = protovalidate.GlobalValidator.Validate(event)
	if err != nil {
		return zero, fmt.Errorf("%w (%T): %w", ErrValidate, event, err)
	}

	return event, nil
}
