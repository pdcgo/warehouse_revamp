package settlement_v1

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
)

// OrderSaleHandler opens and cancels an order's account FROM THE ORDER'S EVENTS
// (settlement-opens-the-sale-from-the-order-event). The order never calls settlement: it publishes, and
// this push handler posts `initial_total` from *Order Placed* and `initial_total_cancel` from *Order
// Cancelled*. A short settlement outage loses nothing — Pub/Sub delivers again.
//
// ⚠ A REDELIVERY IS NORMAL, NOT AN ERROR. Pub/Sub delivers at least once, and each post carries a key
// derived from the ORDER (the recipe is the caller's, #the-recipe-is-the-callers-problem), so a second
// delivery finds its own row and returns it unchanged. That is what makes ACKing it safe.
//
// Returning an error NACKs, which is right for a database that is briefly down and wrong for a
// permanently malformed payload — so the subscriptions need a dead-letter policy, and a dead-lettered
// placement is an account repaired by hand (a-missing-account-is-fixed-by-hand).
func (s *Service) OrderSaleHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_OrderPlaced:
			return s.openSale(ctx, variant.OrderPlaced, event.GetOccurredAt().AsTime())
		case *eventsv1.Event_OrderCancelled:
			return s.cancelSale(ctx, variant.OrderCancelled, event.GetOccurredAt().AsTime())
		default:
			// A variant this handler does not consume. ACKed: redelivering a message nothing here will
			// ever handle is a loop, not a retry. The subscriptions filter on event_type, so this is rare.
			return nil
		}
	}
}

// openSale posts the order's `initial_total` — the platform total with the sign flipped, because
// POSITIVE IS MONEY TOWARD US and at this moment the platform owes us the sale.
//
// ⚠ A PLATFORM TOTAL OF 0 OPENS NOTHING, as the order's own call used to skip it: 0 means "not
// recorded", and an account opened at 0 is one nothing can compute against. Placement now refuses an
// order without the total, on both doors (platform-total-is-required-at-finalize, selling 00022), so a new
// order cannot reach here with 0 — the skip stays as the guard for orders placed before that, which carry
// none and must not open an account at 0.
func (s *Service) openSale(ctx context.Context, placed *eventsv1.OrderPlaced, placedAt time.Time) error {
	if placed.GetPlatformTotal() <= 0 {
		return nil
	}

	_, err := s.PostEntry(ctx, PostInput{
		TeamID:  placed.GetTeamId(),
		ShopID:  placed.GetShopId(),
		OrderID: placed.GetOrderId(),
		// Derived from the order, so a redelivery collides instead of opening a second sale.
		UniqueID:       "order-placed:" + strconv.FormatUint(placed.GetOrderId(), 10),
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
		Change:         -placed.GetPlatformTotal(),
		OccurredOn:     placedAt.In(jakarta).Format(time.DateOnly),
		// The person who placed the order is answerable for its opening row (#actor-id-is-the-pic) — the
		// VARIANT's actor, read from the stored order, never the envelope's identity.
		ActorID:         placed.GetActorId(),
		CreatedByUserID: placed.GetActorId(),
	})

	return err
}

// cancelSale posts the order's `initial_total_cancel`.
//
// ⚠ NOTHING TO CANCEL IS A NORMAL ANSWER. An order with no platform total never opened an account, and
// one whose opening was dead-lettered has nothing live — the order's own cancel has committed either way.
func (s *Service) cancelSale(ctx context.Context, cancelled *eventsv1.OrderCancelled, cancelledAt time.Time) error {
	day := cancelledAt.In(jakarta).Format(time.DateOnly)

	_, err := s.CancelSale(ctx, CancelInput{
		TeamID:     cancelled.GetTeamId(),
		ShopID:     cancelled.GetShopId(),
		OrderID:    cancelled.GetOrderId(),
		UniqueID:   saleCancelKey(cancelled.GetOrderId(), day),
		OccurredOn: day,
		ActorID:    cancelled.GetActorId(),
	})
	if errors.Is(err, ErrNothingToCancel) {
		return nil
	}

	return err
}

// saleCancelKey is `hash(order_id + act_date + "cancel")` (#the-cancel-key-is-order-plus-act-date).
//
// ⚠ THE DATE IS THE ACT's — the event's `occurred_at` — never the clock at delivery. A key from `now()`
// is safe only until a redelivery crosses midnight; then it is a new key, and the account is credited
// twice.
func saleCancelKey(orderID uint64, actDate string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d|%s|cancel", orderID, actDate)))

	return "order-cancelled:" + hex.EncodeToString(sum[:])
}
