package financial_account_v1

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// RestockPaymentHandler is the listener that posts a RESTOCK's payment — inventory's `RestockCreated`,
// `RestockUpdated` and `RestockCancelled` — on the account the restock names as having paid
// (a-restock-must-name-the-account-that-paid, a-created-restock-tells-the-financial-account,
// a-restock-names-its-paying-account). `restock` is broker-only (restock-is-never-typed-by-hand), and this is its
// one way in (one-way-in-per-type).
//
//   - Created: the whole amount, goods plus shipping, OUT of the paying account.
//   - Updated, the same account: the DIFFERENCE, new minus old (an-edit-sends-the-difference) — a lower total
//     comes back in.
//   - Updated, another account: the old amount back INTO the old account and the new amount OUT of the new one,
//     one group (an-edit-may-move-the-payment-to-another-account).
//   - Cancelled with money returned: the amount back INTO the account that paid; without, nothing.
//
// Every event carries its own delta, so the rows COMMUTE: an edit delivered before its create, or a cancel before an
// edit, still leaves the account at the same balance once all have arrived — no ordering is needed.
//
// It follows the handler contract (one-contract-for-both-handler-types): one event, its own transaction, the event id
// CLAIMED inside it beside the write — a redelivery posts nothing, and a failure rolls the claim back with the post, so
// the redelivery genuinely retries.
func (s *Service) RestockPaymentHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_RestockCreated:
			return s.postRestockCreated(ctx, event, variant.RestockCreated)
		case *eventsv1.Event_RestockUpdated:
			return s.postRestockUpdated(ctx, event, variant.RestockUpdated)
		case *eventsv1.Event_RestockCancelled:
			return s.postRestockCancelled(ctx, event, variant.RestockCancelled)
		default:
			// A variant this listener does not post. ACKed: redelivering what nothing here will ever handle is a
			// loop, not a retry. The subscriptions' event_type filters keep it from arriving at all.
			return nil
		}
	}
}

// paymentLeg is one row a payment event posts (a restock's, a warehouse transfer's shipping): which account, the signed
// change, the words.
type paymentLeg struct {
	accountID   uint64
	change      float64
	description string
}

func (s *Service) postRestockCreated(ctx context.Context, event *eventsv1.Event, created *eventsv1.RestockCreated) error {
	if san_money.IsZero(created.GetAmount()) {
		return s.claimOnly(ctx, event)
	}

	// NOT acked: a restock that paid something with no account to take it from is money this build cannot file.
	// Inventory refuses a create without one; this is the listener not trusting that.
	if created.GetFinanceAccountId() == 0 {
		return fmt.Errorf("financial_account: %s: a restock payment with no account it was paid from", event.GetEventId())
	}

	return s.postPaymentLegs(ctx, event, m.ChangeRestock, created.GetTeamId(), created.GetActorId(),
		actDay(event, created.GetCreatedAtUnix()), []paymentLeg{{
			accountID:   created.GetFinanceAccountId(),
			change:      -created.GetAmount(),
			description: fmt.Sprintf("Restock #%d", created.GetRestockId()),
		}})
}

func (s *Service) postRestockUpdated(ctx context.Context, event *eventsv1.Event, updated *eventsv1.RestockUpdated) error {
	oldAccount, newAccount := updated.GetOldFinanceAccountId(), updated.GetNewFinanceAccountId()
	ref := fmt.Sprintf("Restock #%d", updated.GetRestockId())
	at := actDay(event, updated.GetUpdatedAtUnix())

	var legs []paymentLeg

	switch {
	case oldAccount == newAccount || oldAccount == 0:
		// The same account: only what changed. ⚠ my spec — OLD ACCOUNT 0 is a restock raised before *Paid from*
		// existed: its payment predates the ledger and sits in the account's opening balance (restocks already made
		// keep their payment_type, nothing posts back). Naming an account on its first edit posts only the
		// difference into it, never the whole restock again.
		diff := updated.GetNewAmount() - updated.GetOldAmount()
		if !san_money.IsZero(diff) {
			legs = append(legs, paymentLeg{accountID: newAccount, change: -diff, description: ref + " edited"})
		}

	default:
		// Moved: the old account gets back what it paid, the new one pays the new amount.
		if !san_money.IsZero(updated.GetOldAmount()) {
			legs = append(legs, paymentLeg{accountID: oldAccount, change: updated.GetOldAmount(), description: ref + " moved to another account"})
		}

		if !san_money.IsZero(updated.GetNewAmount()) {
			legs = append(legs, paymentLeg{accountID: newAccount, change: -updated.GetNewAmount(), description: ref + " moved from another account"})
		}
	}

	if len(legs) == 0 {
		return s.claimOnly(ctx, event)
	}

	for _, leg := range legs {
		// NOT acked: an edit that moved money into or out of no account. Inventory refuses an edit without one.
		if leg.accountID == 0 {
			return fmt.Errorf("financial_account: %s: a restock edit moved money with no account named", event.GetEventId())
		}
	}

	return s.postPaymentLegs(ctx, event, m.ChangeRestock, updated.GetTeamId(), updated.GetActorId(), at, legs)
}

func (s *Service) postRestockCancelled(ctx context.Context, event *eventsv1.Event, cancelled *eventsv1.RestockCancelled) error {
	// The money did not come back: nothing posts (a-restock-names-its-paying-account).
	if !cancelled.GetMoneyReturned() || san_money.IsZero(cancelled.GetAmount()) {
		return s.claimOnly(ctx, event)
	}

	// ⚠ my spec — a restock raised before *Paid from* existed names no account, and its payment was never posted
	// here: there is nothing to give back to. ACKED with a log line; the refund reaches the account through a
	// reconcile, as the payment itself did.
	if cancelled.GetFinanceAccountId() == 0 {
		slog.WarnContext(ctx, "financial_account: a refunded restock names no account — nothing posted",
			"event_id", event.GetEventId())

		return s.claimOnly(ctx, event)
	}

	return s.postPaymentLegs(ctx, event, m.ChangeRestock, cancelled.GetTeamId(), cancelled.GetActorId(),
		actDay(event, cancelled.GetCancelledAtUnix()), []paymentLeg{{
			accountID:   cancelled.GetFinanceAccountId(),
			change:      cancelled.GetAmount(),
			description: fmt.Sprintf("Restock #%d cancelled — money returned", cancelled.GetRestockId()),
		}})
}

// postPaymentLegs claims the event and posts its legs as `changeType` rows — `restock` for a restock, `expense` for a
// warehouse transfer's shipping (a-transfers-shipping-posts-as-an-expense) — every account LOCKED first in id order, in
// one statement (the ledger's one lock rule) — so a move between two accounts and a transfer the other way cannot
// deadlock. Two legs share a group and name each other, as a move is one act.
//
// An account that is missing, or not the paying team's, is an error and NOT acked: inventory checked the account at
// create and edit, so a mismatch is a bug worth a dead letter, never money to file somewhere else. An ARCHIVED account
// still posts (my spec, as for a withdrawal): refusing would dead-letter money that moved.
func (s *Service) postPaymentLegs(
	ctx context.Context,
	event *eventsv1.Event,
	changeType string,
	teamID, actorID uint64,
	occurredAt time.Time,
	legs []paymentLeg,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		isNew, err := s.dedup.Claim(ctx, tx, event)
		if err != nil {
			return err
		}

		if !isNew {
			return nil
		}

		owners := make(map[uint64]uint64, len(legs))
		for _, leg := range legs {
			owners[leg.accountID] = teamID
		}

		locked, err := lockOwnedAccounts(tx, owners)
		if err != nil {
			return fmt.Errorf("financial_account: %s: %w", event.GetEventId(), err)
		}

		var group uint64
		if len(legs) > 1 {
			group, err = nextGroup(tx)
			if err != nil {
				return err
			}
		}

		for i, leg := range legs {
			var counter uint64
			if len(legs) > 1 {
				counter = legs[1-i].accountID
			}

			_, err = post(tx, locked[leg.accountID], entry{
				changeType:       changeType,
				change:           leg.change,
				description:      leg.description,
				occurredAt:       occurredAt,
				actorID:          actorID,
				groupID:          group,
				counterAccountID: counter,
			})
			if err != nil {
				return err
			}
		}

		return nil
	})
}

// claimOnly records an event that posts nothing — a 0 amount, an edit that changed nothing paid, a cancel with no
// money back — so its redelivery is answered by the claim like any other.
func (s *Service) claimOnly(ctx context.Context, event *eventsv1.Event) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := s.dedup.Claim(ctx, tx, event)

		return err
	})
}

// actDay is when the money moved (the-log-keeps-the-day-the-money-moved): the act's own instant as inventory
// stored it, else the envelope's clock.
func actDay(event *eventsv1.Event, unix int64) time.Time {
	if unix != 0 {
		return time.Unix(unix, 0)
	}

	return event.GetOccurredAt().AsTime()
}
