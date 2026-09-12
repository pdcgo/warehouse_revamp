package san_event

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// IncomingMessage is the normalised inbound form a driver produces. Push and pull differ in how they
// obtain a message and how they acknowledge one, not in what a message IS — so both collapse to this and
// the library has one receive path rather than two.
type IncomingMessage struct {
	Subscription string
	Data         []byte
	Attributes   map[string]string

	// MessageID is the TRANSPORT id — for logs, metrics and rejection records. NEVER the dedup key:
	// it is new on every republish, so keying dedup on it would miss exactly the replays dedup exists
	// for. The dedup key is Event.GetEventId().
	MessageID string

	// DeliveryAttempt is 1 on first delivery. It is what lets the receiver notice "our code is broken
	// on this message" INSIDE our own tooling, where the payload and the reason are visible, rather
	// than after the broker has dead-lettered it.
	DeliveryAttempt int
}

// Result is the outcome of a receive. All three ACK.
//
// Pub/Sub offers NO THIRD OPTION: you ack (or return 200) and it is gone, or you do not and it comes
// back. There is no way to say "I failed, do not retry". So the whole design rests on one distinction:
//
//	err means TRY AGAIN.  A Result means DONE.
//
// A database being down is an error. An event that can never be decoded is Rejected.
type Result int

const (
	// resultUnknown is the zero value on purpose, so a Result returned alongside a non-nil error can
	// never be mistaken for a real outcome.
	resultUnknown Result = iota

	// Handled — the handler took it. Ack.
	Handled

	// Rejected — it will never succeed. Recorded via RejectHandler, and ACKED: a retry fails
	// identically, so a nack buys nothing and costs a redelivery storm.
	Rejected
)

func (r Result) String() string {
	switch r {
	case Handled:
		return "handled"
	case Rejected:
		return "rejected"
	default:
		return "unknown"
	}
}

// Handler processes ONE event (handlers-take-one-event-not-a-batch).
//
// ⚠ NO TRANSACTION IS HANDED OVER. The handler opens its own and claims event_id inside it, beside its
// write — rule 4 of the handler contract (one-contract-for-both-handler-types). Claimed apart from the
// write, a crash between them either suppresses work that never committed or repeats work that did.
// The library ships Claim (see EventDedup) and the handler builds the flow.
//
// Returning an error means TRY AGAIN, and the driver nacks. A variant the handler does not handle
// returns nil — redelivering a message nothing here will ever handle is a loop, not a retry (rule 3).
type Handler func(ctx context.Context, event *eventsv1.Event) error

// Receiver is the library's inbound edge. Drivers in pkgs/event_source call it.
//
// Check err FIRST: when it is non-nil the Result is meaningless, and the driver must NACK.
type Receiver interface {
	Receive(ctx context.Context, msg IncomingMessage) (Result, error)
}

// Registry maps a subscription to the handler registered for it.
//
// It is passed explicitly rather than kept as a package global so a test can register its own handlers
// without leaking them into the next test.
type Registry struct {
	bySubscription map[string]Handler
}

func NewRegistry() *Registry {
	return &Registry{bySubscription: map[string]Handler{}}
}

// Register binds a handler to a subscription.
//
// It was generic over an event type once. With one envelope there is nothing to be generic over: every
// message on every subscription decodes to *eventsv1.Event, so the decode is the same function for all
// of them and the type-erasure it needed is gone with it.
func Register(registry *Registry, subscription string, handler Handler) error {
	if handler == nil {
		return fmt.Errorf("san_event: subscription %q was registered with a nil handler", subscription)
	}

	_, exists := registry.bySubscription[subscription]
	if exists {
		return fmt.Errorf("san_event: subscription %q already has a handler", subscription)
	}

	registry.bySubscription[subscription] = handler

	return nil
}

type receiver struct {
	db          *gorm.DB
	registry    *Registry
	reject      RejectHandler
	maxAttempts int
}

// NewReceiver wires the inbound edge.
//
// maxAttempts is the threshold for RepeatedFailure. ⚠ SET IT BELOW THE SUBSCRIPTION'S
// maxDeliveryAttempts. Then our own handling always fires first, and the dead-letter queue stops being a
// queue and becomes a DETECTOR: anything arriving there means our code died before it could even check —
// a different and far more useful signal than "bad message".
//
// reject is required, not optional. Without it a rejection would be silently dropped, and the payload is
// unrecoverable once acked.
//
// It takes no EventDedup: the CLAIM is the handler's, made in the handler's own transaction beside its
// write (rule 4). The db here is the receiver's own, and it is used for one thing — recording a
// rejection, which happens before the ACK and outside any handler transaction.
func NewReceiver(
	db *gorm.DB,
	registry *Registry,
	reject RejectHandler,
	maxAttempts int,
) (Receiver, error) {
	if db == nil || registry == nil {
		return nil, errors.New("san_event: NewReceiver needs a db and a registry")
	}

	if reject == nil {
		return nil, errors.New("san_event: NewReceiver needs a RejectHandler — a rejection acks, so an unrecorded one is lost forever")
	}

	if maxAttempts < 1 {
		return nil, fmt.Errorf("san_event: maxAttempts must be at least 1, got %d", maxAttempts)
	}

	return &receiver{
		db:          db,
		registry:    registry,
		reject:      reject,
		maxAttempts: maxAttempts,
	}, nil
}

// Receive implements [Receiver].
func (r *receiver) Receive(ctx context.Context, msg IncomingMessage) (Result, error) {
	handle, registered := r.registry.bySubscription[msg.Subscription]
	if !registered {
		// NOT a rejection. This is a configuration bug, and a rejection would ACK — discarding a
		// perfectly good event because a wiring line is missing. Nacking keeps the message alive
		// while somebody fixes the wiring.
		return resultUnknown, fmt.Errorf("san_event: no handler registered for subscription %q", msg.Subscription)
	}

	// Layer 2, checked BEFORE decoding: if our code has already died on this message repeatedly, the
	// next attempt to decode it is as likely to die as the last.
	if msg.DeliveryAttempt > r.maxAttempts {
		return r.recordRejection(ctx, Rejection{
			Reason:       RepeatedFailure,
			Err:          fmt.Errorf("delivery attempt %d exceeded the threshold of %d", msg.DeliveryAttempt, r.maxAttempts),
			Subscription: msg.Subscription,
			Message:      msg,
			Attempt:      msg.DeliveryAttempt,
		})
	}

	event, err := Unmarshal(msg.Data)
	if err != nil {
		reason := Undecodable
		if errors.Is(err, ErrValidate) {
			reason = Invalid
		}

		// EventID is deliberately left empty: the decode failed, so nothing in the payload can be
		// trusted to be the event's id.
		return r.recordRejection(ctx, Rejection{
			Reason:       reason,
			Err:          err,
			Subscription: msg.Subscription,
			Message:      msg,
			Attempt:      msg.DeliveryAttempt,
		})
	}

	err = handle(ctx, event)
	if err != nil {
		// Transient by assumption. The handler's claim and its write share the handler's own
		// transaction, so both rolled back and a redelivery re-runs cleanly.
		return resultUnknown, fmt.Errorf("san_event: cannot handle %q on %q: %w", event.GetEventId(), msg.Subscription, err)
	}

	// Handled covers "the handler did the work" and "the handler found it already claimed and did
	// nothing" alike. The receiver cannot tell them apart any more, and does not need to: both ACK,
	// and the handler is the only thing that knows whether its claim was new.
	return Handled, nil
}

// recordRejection writes the rejection in its OWN transaction and only then reports Rejected, so the
// driver acks an event that is already recorded. If the write fails the caller gets an error and nacks —
// never acknowledge an event you failed to record.
func (r *receiver) recordRejection(ctx context.Context, rejection Rejection) (Result, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return r.reject.Reject(ctx, tx, rejection)
	})
	if err != nil {
		return resultUnknown, fmt.Errorf(
			"san_event: cannot record the %s rejection of message %q — nacking rather than losing it: %w",
			rejection.Reason, rejection.Message.MessageID, err,
		)
	}

	return Rejected, nil
}
