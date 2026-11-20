package financial_account_v1

import (
	"context"
	"fmt"
	"log/slog"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// CustomShipmentShippingHandler is the listener that posts a CUSTOM SHIPMENT's courier cost when the selling team pays it
// directly — *Kami bayar* (the-courier-is-paid-by-the-team-or-by-the-warehouse: *an expense on that account, as a
// warehouse transfer's shipping*) — from inventory's `CustomShipmentCreated`, `CustomShipmentCostUpdated` and
// `CustomShipmentCancelled`. It is TransferShippingHandler's twin (a-transfers-shipping-posts-as-an-expense): an
// `expense` row on the team's account, straight from the parcel's events — no expense record is made, so the Expenses
// screen never lists it — and each row names its parcel: "Custom shipment #88 shipping".
//
//   - Created: the cost OUT of the paying account; a cost of 0 posts nothing (typed later through *Ubah Ongkir*).
//   - CostUpdated, the same account: the DIFFERENCE, new minus old — a lower cost comes back in. Old account 0 is a
//     parcel whose cost was 0 until this edit, so the difference is the whole new cost.
//   - CostUpdated, another account: the old cost back INTO the old account and the new cost OUT of the new one, one
//     group. A cost edited down to 0 is the old account's refund alone.
//   - Cancelled: whatever was posted back INTO the account that paid — a parcel is cancelled only while requested
//     (a-custom-shipment-is-cancelled-only-while-requested), before anything left. A cost of 0 posts nothing.
//
// A *Gudang bayar* parcel (the WAREHOUSE pays) posts NOTHING here, ever: its courier is the warehouse's money, owed back
// through Team Balance from the handover (liability_service). Inventory sends its account and cost as 0; this listener
// does not trust that, so a warehouse-paid parcel can never take money out of the team's account.
//
// Every event carries its own delta, so the rows COMMUTE: an edit delivered before its create, or a cancel before an
// edit, still leaves the account at the same balance once all have arrived. Each edit's event_id is keyed by the
// parcel's cost revision, so two edits never share a claim, and the ids are the parcel's own
// (`custom-shipment-…:<id>`), so custom shipment 603 and warehouse transfer 603 never share one either.
//
// Posted through the restock's postPaymentLegs (claim, the accounts locked in id order, one group for a move) — only
// the words differ from the transfer's.
func (s *Service) CustomShipmentShippingHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_CustomShipmentCreated:
			return s.postCustomShipmentCreated(ctx, event, variant.CustomShipmentCreated)
		case *eventsv1.Event_CustomShipmentCostUpdated:
			return s.postCustomShipmentCostUpdated(ctx, event, variant.CustomShipmentCostUpdated)
		case *eventsv1.Event_CustomShipmentCancelled:
			return s.postCustomShipmentCancelled(ctx, event, variant.CustomShipmentCancelled)
		default:
			// A variant this listener does not post (e.g. Custom Shipment Handed Over, balance's). ACKed: the
			// subscriptions' event_type filters keep it from arriving at all.
			return nil
		}
	}
}

// customShipmentShippingRef is the words every row of a parcel's courier cost carries — the transfer's shape
// ("Warehouse transfer #603 shipping").
func customShipmentShippingRef(customShipmentID uint64) string {
	return fmt.Sprintf("Custom shipment #%d shipping", customShipmentID)
}

// warehousePays is a *Gudang bayar* parcel — its courier is never the team's account's business.
func warehousePays(payer inventoryv1.CustomShipmentPayer) bool {
	return payer == inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE
}

func (s *Service) postCustomShipmentCreated(
	ctx context.Context,
	event *eventsv1.Event,
	created *eventsv1.CustomShipmentCreated,
) error {
	if warehousePays(created.GetPayer()) || san_money.IsZero(created.GetAmount()) {
		if warehousePays(created.GetPayer()) && !san_money.IsZero(created.GetAmount()) {
			slog.WarnContext(ctx, "financial_account: a warehouse-paid custom shipment carried a cost — not the team's, nothing posted",
				"event_id", event.GetEventId())
		}

		return s.claimOnly(ctx, event)
	}

	// NOT acked: a courier cost with no account to take it from is money this build cannot file. Inventory refuses a
	// *Kami bayar* create without one; this is the listener not trusting that.
	if created.GetFinanceAccountId() == 0 {
		return fmt.Errorf("financial_account: %s: a custom shipment's courier cost with no account it was paid from",
			event.GetEventId())
	}

	return s.postPaymentLegs(ctx, event, m.ChangeExpense, created.GetTeamId(), created.GetActorId(),
		actDay(event, created.GetCreatedAtUnix()), []paymentLeg{{
			accountID:   created.GetFinanceAccountId(),
			change:      -created.GetAmount(),
			description: customShipmentShippingRef(created.GetCustomShipmentId()),
		}})
}

// postCustomShipmentCostUpdated posts *Ubah Ongkir*. The event carries no payer: inventory sends it only for a TEAM
// payer's edit that moved money (a *Gudang bayar* parcel refuses the edit).
func (s *Service) postCustomShipmentCostUpdated(
	ctx context.Context,
	event *eventsv1.Event,
	updated *eventsv1.CustomShipmentCostUpdated,
) error {
	oldAccount, newAccount := updated.GetOldFinanceAccountId(), updated.GetNewFinanceAccountId()
	ref := customShipmentShippingRef(updated.GetCustomShipmentId())
	at := actDay(event, updated.GetUpdatedAtUnix())

	var legs []paymentLeg

	switch {
	case oldAccount == newAccount || oldAccount == 0:
		// The same account: only what changed. Old account 0 is a cost of 0 until now (nothing was posted).
		diff := updated.GetNewAmount() - updated.GetOldAmount()
		if !san_money.IsZero(diff) {
			legs = append(legs, paymentLeg{accountID: newAccount, change: -diff, description: ref + " edited"})
		}

	default:
		// Moved (or cost set to 0 with the account emptied): the old account gets back what it paid, the new one pays
		// the new cost.
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
		// NOT acked: an edit that moved money into or out of no account. Inventory refuses a cost without one.
		if leg.accountID == 0 {
			return fmt.Errorf("financial_account: %s: a custom shipment's cost edit moved money with no account named",
				event.GetEventId())
		}
	}

	return s.postPaymentLegs(ctx, event, m.ChangeExpense, updated.GetTeamId(), updated.GetActorId(), at, legs)
}

func (s *Service) postCustomShipmentCancelled(
	ctx context.Context,
	event *eventsv1.Event,
	cancelled *eventsv1.CustomShipmentCancelled,
) error {
	// Nothing was posted for the courier — a warehouse-paid parcel, or a cost of 0: nothing comes back.
	if warehousePays(cancelled.GetPayer()) || san_money.IsZero(cancelled.GetAmount()) {
		return s.claimOnly(ctx, event)
	}

	// ⚠ my spec, as the transfer's — a cost with no account was never posted here: there is nothing to give back to.
	// ACKED with a log line; inventory refuses a *Kami bayar* cost without an account.
	if cancelled.GetFinanceAccountId() == 0 {
		slog.WarnContext(ctx, "financial_account: a cancelled custom shipment's courier cost names no account — nothing posted",
			"event_id", event.GetEventId())

		return s.claimOnly(ctx, event)
	}

	return s.postPaymentLegs(ctx, event, m.ChangeExpense, cancelled.GetTeamId(), cancelled.GetActorId(),
		actDay(event, cancelled.GetCancelledAtUnix()), []paymentLeg{{
			accountID:   cancelled.GetFinanceAccountId(),
			change:      cancelled.GetAmount(),
			description: customShipmentShippingRef(cancelled.GetCustomShipmentId()) + " cancelled — money returned",
		}})
}
