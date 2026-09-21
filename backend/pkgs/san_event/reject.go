package san_event

import (
	"context"

	"gorm.io/gorm"
)

// RejectReason is why an event will never succeed.
type RejectReason int

const (
	// Undecodable — the bytes are not the type this subscription expects.
	Undecodable RejectReason = iota

	// Invalid — decoded, but failed protovalidate.
	Invalid

	// RepeatedFailure — DeliveryAttempt passed the receiver's threshold, so our own code is the
	// thing that is broken on this message.
	RepeatedFailure
)

func (r RejectReason) String() string {
	switch r {
	case Undecodable:
		return "undecodable"
	case Invalid:
		return "invalid"
	case RepeatedFailure:
		return "repeated_failure"
	default:
		return "unknown"
	}
}

// Rejection is an event that will never succeed. The library DETECTS it — a rejection happens before any
// handler is reached, so only the library can see it — and the service DECIDES where it goes.
type Rejection struct {
	Reason       RejectReason
	Err          error
	Subscription string

	// EventID is EMPTY when decoding failed before it could be read. A rejection record therefore
	// cannot always dedup on it.
	EventID string

	// Message is THE ONLY SURVIVING COPY of the payload. See RejectHandler.
	Message IncomingMessage

	Attempt int
}

// RejectHandler is where a service puts events that can never be processed.
//
// ⚠ Rejection.Message IS THE ONLY SURVIVING COPY. Because a rejection ACKs, the broker is finished with
// that event forever — it will never be redelivered and cannot be retrieved later. Two rules follow, and
// the receiver enforces both:
//
//   - RECORD BEFORE ACK. Write the rejection, commit, then let the driver ack. A crash in between means
//     a redelivery, which rejects and records again — harmless.
//   - IF Reject RETURNS AN ERROR, NACK. Never acknowledge an event you failed to record. This is the one
//     place where "it will fail identically next time" is the wrong reasoning: the failure is OURS, not
//     the event's.
//
// ⚠ Dedup a rejection record on Message.MessageID, not EventID — EventID can be empty. MessageID is
// CORRECT here for the same reason it is wrong for event dedup: Pub/Sub keeps one id per message across
// redeliveries, so repeated rejections of one delivery collapse, while a genuinely republished message
// gets a new id and is a new occurrence — which is what a rejection log should show.
type RejectHandler interface {
	Reject(ctx context.Context, tx *gorm.DB, r Rejection) error
}

// RejectFunc adapts a function to [RejectHandler].
type RejectFunc func(ctx context.Context, tx *gorm.DB, r Rejection) error

// Reject implements [RejectHandler].
func (f RejectFunc) Reject(ctx context.Context, tx *gorm.DB, r Rejection) error {
	return f(ctx, tx, r)
}
