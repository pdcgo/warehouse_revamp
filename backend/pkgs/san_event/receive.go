package san_event

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
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

	// Duplicate — Claim said no, so it was already done. Ack.
	Duplicate

	// Rejected — it will never succeed. Recorded via RejectHandler, and ACKED: a retry fails
	// identically, so a nack buys nothing and costs a redelivery storm.
	Rejected
)

func (r Result) String() string {
	switch r {
	case Handled:
		return "handled"
	case Duplicate:
		return "duplicate"
	case Rejected:
		return "rejected"
	default:
		return "unknown"
	}
}

// Handler processes events a service has not seen before.
//
// It is handed the SAME transaction the dedup claim was made in — commit them together or a crash
// between them leaves an event claimed but unprocessed, permanently, because the claim suppresses the
// redelivery that would have fixed it.
//
// The slice is a slice because a driver may deliver one message or many. WHETHER A HANDLER TREATS THAT
// AS A BATCH OR AS A STREAM OF ONE IS THE SERVICE'S DECISION — the library has no opinion, and the delta
// rule (guidelines/event-guideline.md #3) is what makes that a free choice rather than a trap.
type Handler[T Event] func(ctx context.Context, tx *gorm.DB, events []T) error

// Receiver is the library's inbound edge. Drivers in pkgs/event_source call it.
//
// Check err FIRST: when it is non-nil the Result is meaningless, and the driver must NACK.
type Receiver interface {
	Receive(ctx context.Context, msg IncomingMessage) (Result, error)
}

// registration is one subscription's decode+dispatch pair, with T erased.
//
// The type parameter cannot survive into the map, but it does not need to: both closures are built by
// Register, where T is still known. So the concrete type is resolved at registration time and nothing
// ever looks a message type up through protoregistry — dynamicpb never appears.
type registration struct {
	decode func(data []byte) (Event, error)
	handle func(ctx context.Context, tx *gorm.DB, events []Event) error
}

// Registry maps a subscription to the handler registered for it.
//
// It is passed explicitly rather than kept as a package global so a test can register its own handlers
// without leaking them into the next test.
type Registry struct {
	bySubscription map[string]registration
}

func NewRegistry() *Registry {
	return &Registry{bySubscription: map[string]registration{}}
}

// Register binds a typed handler to a subscription.
//
// It is a function rather than a method because Go has no generic methods — the type parameter has to
// live on a free function. That is the only reason the registry is an argument.
func Register[T Event](registry *Registry, subscription string, handler Handler[T]) error {
	_, exists := registry.bySubscription[subscription]
	if exists {
		return fmt.Errorf("san_event: subscription %q already has a handler", subscription)
	}

	registry.bySubscription[subscription] = registration{
		decode: func(data []byte) (Event, error) {
			return Unmarshal[T](data)
		},
		handle: func(ctx context.Context, tx *gorm.DB, events []Event) error {
			typed := make([]T, 0, len(events))

			for _, event := range events {
				one, ok := event.(T)
				if !ok {
					return fmt.Errorf("san_event: %T is not the type registered for %q", event, subscription)
				}

				typed = append(typed, one)
			}

			return handler(ctx, tx, typed)
		},
	}

	return nil
}

type receiver struct {
	db          *gorm.DB
	registry    *Registry
	dedup       EventDedup
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
func NewReceiver(
	db *gorm.DB,
	registry *Registry,
	dedup EventDedup,
	reject RejectHandler,
	maxAttempts int,
) (Receiver, error) {
	if db == nil || registry == nil || dedup == nil {
		return nil, errors.New("san_event: NewReceiver needs a db, a registry and a dedup")
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
		dedup:       dedup,
		reject:      reject,
		maxAttempts: maxAttempts,
	}, nil
}

// Receive implements [Receiver].
func (r *receiver) Receive(ctx context.Context, msg IncomingMessage) (Result, error) {
	entry, registered := r.registry.bySubscription[msg.Subscription]
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

	event, err := entry.decode(msg.Data)
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

	claimed := false

	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		isNew, claimErr := r.dedup.Claim(ctx, tx, event)
		if claimErr != nil {
			return claimErr
		}

		if !isNew {
			return nil
		}

		claimed = true

		return entry.handle(ctx, tx, []Event{event})
	})
	if err != nil {
		// Transient by assumption — the handler and the claim share this transaction, so both rolled
		// back and a redelivery re-runs cleanly.
		return resultUnknown, fmt.Errorf("san_event: cannot handle %q on %q: %w", event.GetEventId(), msg.Subscription, err)
	}

	if !claimed {
		return Duplicate, nil
	}

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
