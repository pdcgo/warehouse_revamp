package san_event_test

import (
	"errors"
	"testing"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
)

func validEvent() *sellingv1.OrderPlacedEvent {
	return &sellingv1.OrderPlacedEvent{
		EventId:        "order-placed:8241",
		OccurredAtUnix: 1753920000,
		TeamId:         3,
		OrderId:        8241,
		Revenue:        250000,
	}
}

func TestMarshalUnmarshalRoundTrip(t *testing.T) {
	data, err := san_event.Marshal(validEvent())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	back, err := san_event.Unmarshal[*sellingv1.OrderPlacedEvent](data)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if back.GetEventId() != "order-placed:8241" || back.GetOrderId() != 8241 {
		t.Fatalf("round trip lost fields: %+v", back)
	}
}

// A publisher must be able to ADD a field without breaking a consumer that has not regenerated yet.
func TestUnmarshalDiscardsUnknownFields(t *testing.T) {
	data := []byte(`{"eventId":"order-placed:1","occurredAtUnix":1753920000,"someFutureField":"x"}`)

	event, err := san_event.Unmarshal[*sellingv1.OrderPlacedEvent](data)
	if err != nil {
		t.Fatalf("an unknown field must not fail the decode: %v", err)
	}

	if event.GetEventId() != "order-placed:1" {
		t.Fatalf("known fields must still decode: %+v", event)
	}
}

func TestUnmarshalRejectsMalformedBytes(t *testing.T) {
	_, err := san_event.Unmarshal[*sellingv1.OrderPlacedEvent]([]byte(`{not json`))

	if !errors.Is(err, san_event.ErrDecode) {
		t.Fatalf("want ErrDecode, got %v", err)
	}
}

// The contract fields are enforced by buf.validate, on every read — including every read during a
// rebuild. This is what makes the loosen-only rule mandatory rather than advisory.
func TestUnmarshalRejectsAnEventMissingTheContractFields(t *testing.T) {
	cases := map[string]string{
		"no event_id":          `{"occurredAtUnix":1753920000}`,
		"empty event_id":       `{"eventId":"","occurredAtUnix":1753920000}`,
		"no occurred_at":       `{"eventId":"order-placed:1"}`,
		"zero occurred_at":     `{"eventId":"order-placed:1","occurredAtUnix":0}`,
		"negative occurred_at": `{"eventId":"order-placed:1","occurredAtUnix":-1}`,
	}

	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := san_event.Unmarshal[*sellingv1.OrderPlacedEvent]([]byte(payload))

			if !errors.Is(err, san_event.ErrValidate) {
				t.Fatalf("want ErrValidate, got %v", err)
			}
		})
	}
}

// DiscardUnknown is permissive, so a payload of the WRONG TYPE decodes into a mostly-empty message
// instead of failing. Validation is what catches it — this test is the proof of that claim, because
// the design gives up strict decoding to get forward compatibility.
func TestUnmarshalCatchesAWrongTypePayloadViaValidation(t *testing.T) {
	// A well-formed message of some other shape entirely.
	foreign := []byte(`{"customerName":"ani","totalDue":900}`)

	_, err := san_event.Unmarshal[*sellingv1.OrderPlacedEvent](foreign)

	if !errors.Is(err, san_event.ErrValidate) {
		t.Fatalf("a wrong-type payload must be caught by validation, got %v", err)
	}
}
