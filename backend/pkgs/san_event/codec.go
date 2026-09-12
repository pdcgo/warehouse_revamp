package san_event

import (
	"errors"
	"fmt"

	"buf.build/go/protovalidate"
	"google.golang.org/protobuf/encoding/protojson"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// The two failure modes of a read, kept distinguishable because the receiver classifies a rejection by
// them (Undecodable vs Invalid) and a human reading the rejection log needs to know which happened.
var (
	// ErrDecode — the bytes are not an Event at all.
	ErrDecode = errors.New("san_event: cannot decode event")

	// ErrValidate — the bytes decoded, but the event does not satisfy its buf.validate rules. An
	// unset oneof lands here (the-event-oneof-is-required), which is the case this distinction was
	// worth making for.
	ErrValidate = errors.New("san_event: event failed validation")
)

// Marshal encodes an event for the wire.
//
// THE FORMAT IS protojson (events-are-encoded-with-protojson) AND THERE IS NO FORMAT TAG ON THE
// PAYLOAD, so changing it would strand every message already published.
//
// It beat binary proto on LEGIBILITY, not size — binary wins size 3-5x. The whole failure story in
// this design ends with a human reading a payload: a rejection row, a dead-letter message, a log line.
// protojson is readable in the Pub/Sub console with no tooling and no message type to hand.
//
// ⚠ The cost, and it is permanent: the wire identity of a field is its NAME. Renaming one — above all
// renaming a oneof arm, which drops the entire body — orphans every message already published, and the
// compiler cannot see it. `buf breaking` in CI is what does
// (ci-runs-on-dev-and-checks-breaking).
func Marshal(event *eventsv1.Event) ([]byte, error) {
	data, err := protojson.Marshal(event)
	if err != nil {
		return nil, fmt.Errorf("san_event: cannot marshal event %q: %w", event.GetEventId(), err)
	}

	return data, nil
}

// Unmarshal decodes bytes into an Event and validates the result. Services read events through this
// and never through protojson directly, so one place decides the format, the decode options, and that
// validation happens — twelve services cannot drift apart, and NOTHING DOWNSTREAM CAN EVER HOLD AN
// INVALID EVENT, on the receive path or on a replay.
//
// This is the ONE decoder (the-library-has-one-decoder). Strict decoding was the alternative and it is
// worse: it turns a field a producer merely ADDED into a dead-letter, punishing consumers for a change
// meant to be compatible.
//
// DiscardUnknown is what makes an added field harmless. What makes that leniency SAFE is the required
// oneof: an arm this build does not know is dropped, leaves the oneof unset, and fails validation here
// — instead of arriving as a valid Event with no body and being silently accepted.
//
// ⚠ Because this validates on every READ, validation rules may only ever LOOSEN. Tighten one and every
// event already published that no longer passes becomes UNREADABLE — discovered mid-rebuild, in
// production. The metadata caps on the envelope are exempt by construction: they are Pub/Sub's own
// limits, so nothing the broker accepted can fail them.
func Unmarshal(data []byte) (*eventsv1.Event, error) {
	event := &eventsv1.Event{}

	options := protojson.UnmarshalOptions{DiscardUnknown: true}

	err := options.Unmarshal(data, event)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrDecode, err)
	}

	err = protovalidate.GlobalValidator.Validate(event)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrValidate, err)
	}

	return event, nil
}
