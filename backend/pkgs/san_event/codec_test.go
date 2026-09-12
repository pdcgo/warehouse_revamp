package san_event_test

import (
	"errors"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
)

// occurredAt is a fixed instant, so a payload literal below can name the same moment.
const occurredAt = 1753920000

func validEvent() *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     "order-placed:8241",
		OccurredAt:  timestamppb.New(time.Unix(occurredAt, 0).UTC()),
		AggregateId: "order:8241",
		Message: &eventsv1.Event_OrderPlaced{
			OrderPlaced: &eventsv1.OrderPlaced{TeamId: 3, OrderId: 8241, Revenue: 250000},
		},
	}
}

// envelope wraps a variant fragment in the three typed fields, so each test names only what it is
// about.
func envelope(tail string) []byte {
	return []byte(`{"eventId":"order-placed:1","occurredAt":"2025-07-31T00:00:00Z",` +
		`"aggregateId":"order:1",` + tail + `}`)
}

func TestMarshalUnmarshalRoundTrip(t *testing.T) {
	data, err := san_event.Marshal(validEvent())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	back, err := san_event.Unmarshal(data)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if back.GetEventId() != "order-placed:8241" || back.GetOrderPlaced().GetOrderId() != 8241 {
		t.Fatalf("round trip lost fields: %+v", back)
	}
}

// A publisher must be able to ADD a field without breaking a consumer that has not regenerated yet.
// This is the whole reason the decoder is lenient.
func TestUnmarshalDiscardsUnknownFields(t *testing.T) {
	data := envelope(`"someFutureField":"x","orderPlaced":{"orderId":1}`)

	event, err := san_event.Unmarshal(data)
	if err != nil {
		t.Fatalf("an unknown field must not fail the decode: %v", err)
	}

	if event.GetOrderPlaced().GetOrderId() != 1 {
		t.Fatalf("known fields must still decode: %+v", event)
	}
}

func TestUnmarshalRejectsMalformedBytes(t *testing.T) {
	_, err := san_event.Unmarshal([]byte(`{not json`))

	if !errors.Is(err, san_event.ErrDecode) {
		t.Fatalf("want ErrDecode, got %v", err)
	}
}

// The contract fields are enforced by buf.validate, on every read — including every read during a
// rebuild. This is what makes the loosen-only rule mandatory rather than advisory.
func TestUnmarshalRejectsAnEventMissingTheContractFields(t *testing.T) {
	valid := `"aggregateId":"order:1","orderPlaced":{"orderId":1}`

	cases := map[string]string{
		"no event_id":     `{"occurredAt":"2025-07-31T00:00:00Z",` + valid + `}`,
		"empty event_id":  `{"eventId":"","occurredAt":"2025-07-31T00:00:00Z",` + valid + `}`,
		"no occurred_at":  `{"eventId":"x:1",` + valid + `}`,
		"no aggregate_id": `{"eventId":"x:1","occurredAt":"2025-07-31T00:00:00Z","orderPlaced":{"orderId":1}}`,
	}

	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := san_event.Unmarshal([]byte(payload))

			if !errors.Is(err, san_event.ErrValidate) {
				t.Fatalf("want ErrValidate, got %v", err)
			}
		})
	}
}

// the-event-oneof-is-required, and this is the case it exists for.
//
// DiscardUnknown drops an arm this build does not know, which leaves the oneof UNSET — so an event a
// producer added last week arrives at a consumer that has not regenerated looking like a perfectly
// valid envelope with no body. Without the required rule it would be handled as nothing and silently
// ACKed. With it, the read fails and the receiver records a rejection a human can read.
func TestUnmarshalRejectsAnUnknownVariant(t *testing.T) {
	_, err := san_event.Unmarshal(envelope(`"stockMovedInSomeFutureBuild":{"id":1}`))

	if !errors.Is(err, san_event.ErrValidate) {
		t.Fatalf("an envelope whose only variant is unknown must fail validation, got %v", err)
	}
}

func TestUnmarshalRejectsAnEnvelopeWithNoVariant(t *testing.T) {
	_, err := san_event.Unmarshal(envelope(`"metadata":{"a":"b"}`))

	if !errors.Is(err, san_event.ErrValidate) {
		t.Fatalf("want ErrValidate for an event with no variant, got %v", err)
	}
}

// DiscardUnknown is permissive, so a payload of the WRONG TYPE decodes into a mostly-empty message
// instead of failing. Validation is what catches it — this test is the proof of that claim, because
// the design gives up strict decoding to get forward compatibility.
func TestUnmarshalCatchesAWrongTypePayloadViaValidation(t *testing.T) {
	// A well-formed message of some other shape entirely.
	foreign := []byte(`{"customerName":"ani","totalDue":900}`)

	_, err := san_event.Unmarshal(foreign)

	if !errors.Is(err, san_event.ErrValidate) {
		t.Fatalf("a wrong-type payload must be caught by validation, got %v", err)
	}
}

// The metadata caps mirror Pub/Sub's own attribute limits, because the map is copied verbatim into the
// message attributes (event-metadata-is-copied-into-the-attributes). Catching it here names the field —
// the broker's rejection does not.
func TestMetadataValueOverThePubsubCapIsRejected(t *testing.T) {
	event := validEvent()

	long := make([]byte, 1025)
	for i := range long {
		long[i] = 'x'
	}

	event.Metadata = map[string]string{"note": string(long)}

	data, err := san_event.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	_, err = san_event.Unmarshal(data)
	if !errors.Is(err, san_event.ErrValidate) {
		t.Fatalf("a metadata value over 1024 bytes must fail validation, got %v", err)
	}
}
