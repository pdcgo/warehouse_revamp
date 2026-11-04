package financial_account_v1

import (
	"context"
	"fmt"
	"log/slog"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// TransferShippingHandler is the listener that posts a WAREHOUSE TRANSFER's shipping cost — inventory's
// `WarehouseTransferCreated`, `WarehouseTransferUpdated` and `WarehouseTransferCancelled` — on the selling team's
// account the transfer names as having paid (a-transfer-names-its-paying-account,
// the-shipping-expense-reaches-the-account-by-event). It posts as `expense` (a-transfers-shipping-posts-as-an-expense),
// straight from the transfer's events: no expense record is made, so the Expenses screen never lists it, and each row
// names its transfer — "Warehouse transfer #603 shipping".
//
//   - Created: the shipping cost OUT of the paying account; a cost of 0 posts nothing.
//   - Updated, the same account: the DIFFERENCE, new minus old (an-edit-sends-the-difference) — a lower cost comes
//     back in. Old account 0 is a transfer whose cost was 0 until this edit (inventory empties the account with the
//     cost), so the difference is the whole new cost.
//   - Updated, another account: the old cost back INTO the old account and the new cost OUT of the new one, one group
//     (an-edit-may-move-the-payment-to-another-account). A cost edited down to 0 is the old account's refund alone.
//   - Cancelled: whatever was posted back INTO the account that paid. Unlike a restock's, the event has no
//     money-returned flag — a transfer is cancelled only while `created`, before the box left, and the decision says
//     its event "returns whatever was posted". A cost of 0 posts nothing.
//
// Every event carries its own delta, so the rows COMMUTE: an edit delivered before its create, or a cancel before an
// edit, still leaves the account at the same balance once all have arrived — no ordering is needed. Each edit's
// event_id is keyed by the transfer's cost revision, so two edits never share a claim.
//
// It is RestockPaymentHandler's shape and posts through the same postPaymentLegs (claim, the accounts locked in id
// order, one group for a move) — only the change type and the words differ.
func (s *Service) TransferShippingHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_WarehouseTransferCreated:
			return s.postTransferCreated(ctx, event, variant.WarehouseTransferCreated)
		case *eventsv1.Event_WarehouseTransferUpdated:
			return s.postTransferUpdated(ctx, event, variant.WarehouseTransferUpdated)
		case *eventsv1.Event_WarehouseTransferCancelled:
			return s.postTransferCancelled(ctx, event, variant.WarehouseTransferCancelled)
		default:
			// A variant this listener does not post (e.g. Warehouse Transfer Accepted, balance's). ACKed: the
			// subscriptions' event_type filters keep it from arriving at all.
			return nil
		}
	}
}

func transferShippingRef(transferID uint64) string {
	return fmt.Sprintf("Warehouse transfer #%d shipping", transferID)
}

func (s *Service) postTransferCreated(
	ctx context.Context,
	event *eventsv1.Event,
	created *eventsv1.WarehouseTransferCreated,
) error {
	if rupiah(created.GetAmount()) == 0 {
		return s.claimOnly(ctx, event)
	}

	// NOT acked: a trip that cost something with no account to take it from is money this build cannot file.
	// Inventory refuses a create without one; this is the listener not trusting that.
	if created.GetFinanceAccountId() == 0 {
		return fmt.Errorf("financial_account: %s: a transfer's shipping with no account it was paid from", event.GetEventId())
	}

	return s.postPaymentLegs(ctx, event, m.ChangeExpense, created.GetTeamId(), created.GetActorId(),
		actDay(event, created.GetCreatedAtUnix()), []paymentLeg{{
			accountID:   created.GetFinanceAccountId(),
			change:      -created.GetAmount(),
			description: transferShippingRef(created.GetTransferId()),
		}})
}

func (s *Service) postTransferUpdated(
	ctx context.Context,
	event *eventsv1.Event,
	updated *eventsv1.WarehouseTransferUpdated,
) error {
	oldAccount, newAccount := updated.GetOldFinanceAccountId(), updated.GetNewFinanceAccountId()
	ref := transferShippingRef(updated.GetTransferId())
	at := actDay(event, updated.GetUpdatedAtUnix())

	var legs []paymentLeg

	switch {
	case oldAccount == newAccount || oldAccount == 0:
		// The same account: only what changed. Old account 0 is a cost of 0 until now (nothing was posted), or — ⚠ my
		// spec, as the restock's — a transfer whose cost predates its account: either way only the difference posts.
		diff := updated.GetNewAmount() - updated.GetOldAmount()
		if rupiah(diff) != 0 {
			legs = append(legs, paymentLeg{accountID: newAccount, change: -diff, description: ref + " edited"})
		}

	default:
		// Moved (or cost set to 0, new account empty): the old account gets back what it paid, the new one pays the
		// new cost.
		if rupiah(updated.GetOldAmount()) != 0 {
			legs = append(legs, paymentLeg{accountID: oldAccount, change: updated.GetOldAmount(), description: ref + " moved to another account"})
		}

		if rupiah(updated.GetNewAmount()) != 0 {
			legs = append(legs, paymentLeg{accountID: newAccount, change: -updated.GetNewAmount(), description: ref + " moved from another account"})
		}
	}

	if len(legs) == 0 {
		return s.claimOnly(ctx, event)
	}

	for _, leg := range legs {
		// NOT acked: an edit that moved money into or out of no account. Inventory refuses a cost without one.
		if leg.accountID == 0 {
			return fmt.Errorf("financial_account: %s: a transfer's shipping edit moved money with no account named", event.GetEventId())
		}
	}

	return s.postPaymentLegs(ctx, event, m.ChangeExpense, updated.GetTeamId(), updated.GetActorId(), at, legs)
}

func (s *Service) postTransferCancelled(
	ctx context.Context,
	event *eventsv1.Event,
	cancelled *eventsv1.WarehouseTransferCancelled,
) error {
	// Nothing was posted for the trip: nothing comes back.
	if rupiah(cancelled.GetAmount()) == 0 {
		return s.claimOnly(ctx, event)
	}

	// ⚠ my spec, as the restock's — a cost with no account was never posted here: there is nothing to give back to.
	// ACKED with a log line; inventory refuses a cost without an account, so this is a transfer from before the column.
	if cancelled.GetFinanceAccountId() == 0 {
		slog.WarnContext(ctx, "financial_account: a cancelled transfer's shipping names no account — nothing posted",
			"event_id", event.GetEventId())

		return s.claimOnly(ctx, event)
	}

	return s.postPaymentLegs(ctx, event, m.ChangeExpense, cancelled.GetTeamId(), cancelled.GetActorId(),
		actDay(event, cancelled.GetCancelledAtUnix()), []paymentLeg{{
			accountID:   cancelled.GetFinanceAccountId(),
			change:      cancelled.GetAmount(),
			description: transferShippingRef(cancelled.GetTransferId()) + " cancelled — money returned",
		}})
}
