package san_event_test

import (
	"context"
	"errors"
	"testing"

	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
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
	seen     *[]*sellingv1.OrderPlacedEvent
}

// newHarness wires a receiver over a real dedup table, with a handler that records what it was given.
// handlerErr, when set, is what the handler returns — used to prove a handler failure NACKs.
func newHarness(t *testing.T, db *gorm.DB, table string, handlerErr error) harness {
	t.Helper()

	createDedupTable(t, db, table)

	dedup, err := san_event.NewDedup(table)
	if err != nil {
		t.Fatalf("new dedup: %v", err)
	}

	seen := []*sellingv1.OrderPlacedEvent{}

	registry := san_event.NewRegistry()

	err = san_event.Register(registry, testSubscription,
		func(_ context.Context, _ *gorm.DB, events []*sellingv1.OrderPlacedEvent) error {
			if handlerErr != nil {
				return handlerErr
			}

			seen = append(seen, events...)

			return nil
		})
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	rejects := &capturedReject{}

	receiver, err := san_event.NewReceiver(db, registry, dedup, rejects, 5)
	if err != nil {
		t.Fatalf("new receiver: %v", err)
	}

	return harness{receiver: receiver, rejects: rejects, seen: &seen}
}

func message(t *testing.T, event *sellingv1.OrderPlacedEvent) san_event.IncomingMessage {
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

	if result != san_event.Duplicate {
		t.Fatalf("want Duplicate, got %s", result)
	}

	if len(*h.seen) != 1 {
		t.Fatalf("the handler must run exactly once, ran %d times", len(*h.seen))
	}
}

func TestReceiveRejectsAnInvalidPayloadAndRecordsIt(t *testing.T) {
	db := san_testdb.DB(t)
	h := newHarness(t, db, "recv_invalid_test", nil)

	msg := san_event.IncomingMessage{
		Subscription:    testSubscription,
		Data:            []byte(`{"teamId":"3"}`), // decodes, but carries neither contract field
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

	if len(*h.seen) != 0 {
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
// shares the handler's transaction, so it must roll back with it or the redelivery would be swallowed
// as a duplicate.
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

	handler := func(_ context.Context, _ *gorm.DB, _ []*sellingv1.OrderPlacedEvent) error { return nil }

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

	dedup, err := san_event.NewDedup("recv_norejects_test")
	if err != nil {
		t.Fatalf("new dedup: %v", err)
	}

	_, err = san_event.NewReceiver(db, san_event.NewRegistry(), dedup, nil, 5)
	if err == nil {
		t.Fatal("a receiver with no RejectHandler would drop rejections silently")
	}
}
