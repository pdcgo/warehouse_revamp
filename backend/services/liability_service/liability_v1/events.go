package liability_v1

import (
	"context"
	"log/slog"
	"strconv"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// publishAccepted announces a committed acceptance as `LiabilityPaymentAccepted` — the one event the
// financial accounts hear from a team payment (a-team-payment-posts-on-accept).
//
// ⚠ A PUBLISH FAILURE DOES NOT FAIL THE ACCEPT. The payment is confirmed and the debt is settled in the
// books; that is the truth, and the event is how the accounts learn of it (no-outbox-the-publish-is-trusted).
// A lost publish is logged with its event_id, and a reconcile on either account is what finds the gap.
func (s *Service) publishAccepted(ctx context.Context, payment *liability_service_models.LiabilityPayment) {
	event := acceptedEvent(payment)

	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "liability payment accepted but LiabilityPaymentAccepted was not published — "+
			"the accounts did not move; reconcile both",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}

// acceptedEvent builds the event for one accepted payment. Pure, so a test can read what would be sent.
func acceptedEvent(p *liability_service_models.LiabilityPayment) *eventsv1.Event {
	ref := strconv.FormatUint(p.ID, 10)

	// When the creditor accepted — the day both rows count on. Always set on a confirmed payment; the
	// fallback only keeps a malformed row from building an event with no clock.
	acceptedAt := p.UpdatedAt
	if p.ConfirmedAt != nil {
		acceptedAt = *p.ConfirmedAt
	}

	return &eventsv1.Event{
		// DERIVED from the payment, never a fresh UUID: a payment is accepted once, so a retried publish
		// must collide in the accounts' dedup rather than post the transfer twice.
		EventId:     "liability-payment-accepted:" + ref,
		OccurredAt:  timestamppb.New(acceptedAt),
		AggregateId: "liability-payment:" + ref,
		Message: &eventsv1.Event_LiabilityPaymentAccepted{
			LiabilityPaymentAccepted: &eventsv1.LiabilityPaymentAccepted{
				PaymentId:      p.ID,
				PayerTeamId:    p.PayerTeamID,
				CreditorTeamId: p.CreditorTeamID,
				Amount:         p.Amount,
				FromAccountId:  p.FromAccountID,
				ToAccountId:    p.ToAccountID,
				ActorId:        p.ConfirmedBy,
			},
		},
	}
}

// publishIdentity is who caused the publish: the caller when a request put one on the ctx, and an explicit
// system identity otherwise (identity-is-a-sender-parameter).
func publishIdentity(ctx context.Context) *role_basev1.Identity {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return event_source.SystemIdentity("liability_service")
	}

	return identity
}
