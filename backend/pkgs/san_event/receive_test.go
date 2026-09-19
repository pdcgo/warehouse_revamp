package san_event_test

import (
	"context"
	"errors"
	"testing"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

const testSubscription = "order-placed-test-sub"

type capturedReject struct {
	rejections []san_event.Rejection
	fail       error
}

func (c *capturedReject) Reject(_ context.Context, _ *gorm.DB, r san_event.Rejection) error {
	if c.fail != nil {
		return c.fail
	}

	c.rejections = append(c.rejections, r)

	return nil
}

type harness struct {
	receiver san_event.Receiver
	rejects  *capturedReject
	worked   *[]*eventsv1.Event
}

// newHarness wires a receiver over a real dedup table, with a handler written the way the contract
// says one is written: it opens its OWN transaction, claims event_id inside it, and does its work in
// the same transaction (rule 4 of one-contract-for-both-handler-types). The receiver hands over no
// transaction and does no claiming — the library ships Claim, the handler builds the flow.
//
// handlerErr, when set, is what the work returns — used to prove a handler failure NACKs AND rolls the
// claim back with it.
func newHarness(t *testing.T, db *gorm.DB, table string, handlerErr error) harness {
	t.Helper()

	createDedupTable(t, db, table)

	dedup, err := san_event.NewDedup(table)
	if err != nil {
		t.Fatalf("new dedup: %v", err)
	}

	worked := []*eventsv1.Event{}

	registry := san_event.NewRegistry()

	err = san_event.Register(registry, testSubscription, func(ctx context.Context, event *eventsv1.Event) error {
		return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			isNew, claimErr := dedup.Claim(ctx, tx, event)
			if claimErr != nil {
				return claimErr
			}

			// Already done. Returning nil ACKs it — a redelivery is normal, not an error.
			if !isNew {
				return nil
			}

			if handlerErr != nil {
				return handlerErr
			}

			worked = append(worked, event)

			return nil
		})
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	rejects := &capturedReject{}

	receiver, err := san_event.NewReceiver(db, registry, rejects, 5)
	if err != nil {
		t.Fatalf("new receiver: %v", err)
	}

	return harness{receiver: receiver, rejects: rejects, worked: &worked}
}

func message(t *testing.T, event *eventsv1.Event) san_event.IncomingMessage {
	t.Helper()

	data, err := san_event.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	return san_event.IncomingMessage{
		Subscription:    testSubscription,
		Data:            data,
		MessageID:       "transport-1",
		DeliveryAttempt: 1,
	}
}

func TestReceiveHandlesAndThenDeduplicates(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_handled_test", nil)

	ctx := context.Background()
	msg := message(t, validEvent())

	result, err := h.receiver.Receive(ctx, msg)
	if err != nil {
		t.Fatalf("first receive: %v", err)
	}

	if result != san_event.Handled {
		t.Fatalf("want Handled, got %s", result)
	}

	// The redelivery Pub/Sub guarantees will eventually happen. A NEW transport id, because a
	// republish gets one — which is exactly why dedup cannot key on MessageID.
	redelivery := msg
	redelivery.MessageID = "transport-2"
	redelivery.DeliveryAttempt = 2

	result, err = h.receiver.Receive(ctx, redelivery)
	if err != nil {
		t.Fatalf("redelivery: %v", err)
	}

	// Handled either way: the receiver cannot see the claim any more, and does not need to. Both ACK.
	if result != san_event.Handled {
		t.Fatalf("want Handled, got %s", result)
	}

	// What matters is that the WORK ran once — which is the handler's claim doing its job.
	if len(*h.worked) != 1 {
		t.Fatalf("the work must run exactly once, ran %d times", len(*h.worked))
	}
}

func TestReceiveRejectsAnInvalidPayloadAndRecordsIt(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_invalid_test", nil)

	msg := san_event.IncomingMessage{
		Subscription:    testSubscription,
		Data:            []byte(`{"aggregateId":"order:1"}`), // decodes, but has no id, time or variant
		MessageID:       "transport-bad",
		DeliveryAttempt: 1,
	}

	result, err := h.receiver.Receive(context.Background(), msg)
	if err != nil {
		t.Fatalf("a rejection ACKs — it must not return an error: %v", err)
	}

	if result != san_event.Rejected {
		t.Fatalf("want Rejected, got %s", result)
	}

	if len(h.rejects.rejections) != 1 {
		t.Fatalf("the rejection must be recorded, got %d", len(h.rejects.rejections))
	}

	rejection := h.rejects.rejections[0]

	if rejection.Reason != san_event.Invalid {
		t.Fatalf("want Invalid, got %s", rejection.Reason)
	}

	// The only surviving copy: once acked, the broker is finished with this event forever.
	if string(rejection.Message.Data) != string(msg.Data) {
		t.Fatal("the rejection must carry the raw payload — it is the only copy left")
	}
}

// the-event-oneof-is-required, at the receiver: an arm this build does not know is dropped by
// DiscardUnknown, so the envelope arrives valid-looking with no body. It must be RECORDED and acked,
// not handed to a handler with nothing to dispatch on.
func TestReceiveRejectsAnEnvelopeWhoseVariantIsUnknown(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_unknownvariant_test", nil)

	result, err := h.receiver.Receive(context.Background(), san_event.IncomingMessage{
		Subscription: testSubscription,
		Data: []byte(`{"eventId":"x:1","occurredAt":"2025-07-31T00:00:00Z",` +
			`"aggregateId":"x:1","stockMovedInSomeFutureBuild":{"id":1}}`),
		MessageID:       "transport-future",
		DeliveryAttempt: 1,
	})
	if err != nil {
		t.Fatalf("a rejection ACKs: %v", err)
	}

	if result != san_event.Rejected {
		t.Fatalf("want Rejected, got %s", result)
	}

	if len(*h.worked) != 0 {
		t.Fatal("an envelope with no variant must never reach the handler")
	}
}

func TestReceiveRejectsUndecodableBytes(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_undecodable_test", nil)

	result, err := h.receiver.Receive(context.Background(), san_event.IncomingMessage{
		Subscription:    testSubscription,
		Data:            []byte(`{not json`),
		MessageID:       "transport-bad",
		DeliveryAttempt: 1,
	})
	if err != nil {
		t.Fatalf("a rejection ACKs: %v", err)
	}

	if result != san_event.Rejected {
		t.Fatalf("want Rejected, got %s", result)
	}

	if h.rejects.rejections[0].Reason != san_event.Undecodable {
		t.Fatalf("want Undecodable, got %s", h.rejects.rejections[0].Reason)
	}

	// EventID is empty on purpose: the decode failed, so nothing in the payload can be trusted to be
	// the event's id. This is why a rejection record dedups on MessageID instead.
	if h.rejects.rejections[0].EventID != "" {
		t.Fatal("EventID must be empty when the decode failed before it could be read")
	}
}

// Layer 2: our own code is what keeps dying on this message. Caught INSIDE our tooling, where the
// payload and the reason are visible, rather than after the broker has dead-lettered it.
func TestReceiveRejectsOnceTheDeliveryAttemptThresholdIsPassed(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_repeated_test", nil)

	msg := message(t, validEvent())
	msg.DeliveryAttempt = 6 // the harness sets maxAttempts to 5

	result, err := h.receiver.Receive(context.Background(), msg)
	if err != nil {
		t.Fatalf("a rejection ACKs: %v", err)
	}

	if result != san_event.Rejected {
		t.Fatalf("want Rejected, got %s", result)
	}

	if h.rejects.rejections[0].Reason != san_event.RepeatedFailure {
		t.Fatalf("want RepeatedFailure, got %s", h.rejects.rejections[0].Reason)
	}

	if len(*h.worked) != 0 {
		t.Fatal("the handler must not run for a message past the threshold")
	}
}

// NEVER acknowledge an event you failed to record. This is the one place where "it will fail
// identically next time" is the wrong reasoning: the failure is ours, not the event's.
func TestReceiveNacksWhenTheRejectionCannotBeRecorded(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_rejectfail_test", nil)

	h.rejects.fail = errors.New("the rejection table is unreachable")

	_, err := h.receiver.Receive(context.Background(), san_event.IncomingMessage{
		Subscription:    testSubscription,
		Data:            []byte(`{not json`),
		MessageID:       "transport-bad",
		DeliveryAttempt: 1,
	})

	if err == nil {
		t.Fatal("an unrecorded rejection must NACK — acking it would lose the only copy of the payload")
	}
}

// err means TRY AGAIN. A handler failure is transient by assumption, so it must NACK — and the claim
// shares the handler's own transaction, so it must roll back with it or the redelivery would be
// swallowed as a duplicate. This is rule 4 proved end to end, now that the transaction is the
// handler's rather than the library's.
func TestReceiveNacksAndUnclaimsWhenTheHandlerFails(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_handlerfail_test", errors.New("the projection table is locked"))

	ctx := context.Background()
	msg := message(t, validEvent())

	_, err := h.receiver.Receive(ctx, msg)
	if err == nil {
		t.Fatal("a handler failure must NACK")
	}

	count := int64(0)

	err = db.Raw(`SELECT count(*) FROM recv_handlerfail_test`).Scan(&count).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if count != 0 {
		t.Fatal("the claim must roll back with the handler — otherwise the redelivery is suppressed as a duplicate and the event is lost")
	}
}

// A missing registration is a WIRING bug, not a bad event. Rejecting would ack — discarding a perfectly
// good event because a line of configuration is absent.
func TestReceiveNacksAnUnregisteredSubscription(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_unregistered_test", nil)

	msg := message(t, validEvent())
	msg.Subscription = "some-subscription-nobody-registered"

	_, err := h.receiver.Receive(context.Background(), msg)
	if err == nil {
		t.Fatal("an unregistered subscription must NACK, not silently discard the event")
	}

	if len(h.rejects.rejections) != 0 {
		t.Fatal("a wiring bug is not a rejection — rejecting would ACK a good event")
	}
}

func TestRegisterRefusesASecondHandlerForOneSubscription(t *testing.T) {
	registry := san_event.NewRegistry()

	handler := func(_ context.Context, _ *eventsv1.Event) error { return nil }

	err := san_event.Register(registry, testSubscription, handler)
	if err != nil {
		t.Fatalf("first register: %v", err)
	}

	err = san_event.Register(registry, testSubscription, handler)
	if err == nil {
		t.Fatal("a silently replaced handler is how a subscription stops being processed")
	}
}

// A rejection ACKs, so an unrecorded one is lost forever. The receiver must not be constructible
// without somewhere to put them.
func TestNewReceiverRequiresARejectHandler(t *testing.T) {
	db := san_testdb.DB(t)

	_, err := san_event.NewReceiver(db, san_event.NewRegistry(), nil, 5)
	if err == nil {
		t.Fatal("a receiver with no RejectHandler would drop rejections silently")
	}
}
