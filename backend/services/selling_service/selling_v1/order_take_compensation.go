package selling_v1

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// THE COMPENSATION OF A FAILED CREATE (backlog #10 slice 3) — what placeOrder runs on any failure once the stock take
// was called, a KEY_USED refusal excepted (a-used-key-is-never-cancelled).

// compensateTake gives back whatever was taken under the order's key K: the DIRECT release first, then InventoryTxCancel
// as the backup (the-release-is-direct-then-the-event). A release that finds the take already released does nothing, so
// the two never give stock back twice; a release of a key nothing was taken under claims it, so a take that lands late
// is refused (every-release-goes-by-the-key).
//
// UNDER A CONTEXT THE BROWSER LEAVING CANNOT CANCEL — context.WithoutCancel keeps the identity (the release's ledger rows
// name the person who placed the order) and drops the cancellation and any deadline: a person who closes the tab
// mid-create is exactly the case this exists for (no-answer-is-only-a-lost-connection).
//
// It never fails the caller: the order has already failed, and the caller reports THAT. Stock stays taken only when
// both the release and the publish fail — logged as an error naming K, the one thing someone must release by hand.
func (s *Service) compensateTake(ctx context.Context, p *orderPlacement, reason string) {
	ctx = context.WithoutCancel(ctx)

	releaseErr := s.stock.Return(ctx, p.teamID, p.warehouseID, p.idempotencyKey)
	if releaseErr != nil {
		slog.ErrorContext(ctx, "order create failed after its stock take and the direct release failed — "+
			"InventoryTxCancel is the backup",
			"idempotency_key", p.idempotencyKey,
			"team_id", p.teamID,
			"warehouse_id", p.warehouseID,
			"error", releaseErr,
		)
	}

	// ALWAYS published, the direct release's success included: the listener's release is a no-op on a released take, and
	// a direct call that answered "released" over a connection that then broke is indistinguishable from one that did not.
	// event_id is derived from K — one compensation per key, so a retried publish collides in the listener.
	publishErr := s.events(ctx, eventIdentity(ctx), &eventsv1.Event{
		EventId:     "inventory-tx-cancel:" + p.idempotencyKey,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "order-key:" + p.idempotencyKey,
		Message: &eventsv1.Event_InventoryTxCancel{
			InventoryTxCancel: &eventsv1.InventoryTxCancel{
				IdempotencyKey: p.idempotencyKey,
				// The selling team the take was made for — the listener's release is checked against it
				// (the-cancel-event-names-the-team).
				TeamId:      p.teamID,
				WarehouseId: p.warehouseID,
				// Who placed the failed order — the person the release's rows name.
				ActorId: eventActor(ctx),
				Reason:  reason,
			},
		},
	})
	if publishErr == nil {
		return
	}

	if releaseErr != nil {
		slog.ErrorContext(ctx, "STOCK STILL TAKEN: an order create failed after its stock take, and neither the direct "+
			"release nor the InventoryTxCancel publish went through — release the key by hand "+
			"(OrderTransactionRelease)",
			"idempotency_key", p.idempotencyKey,
			"team_id", p.teamID,
			"warehouse_id", p.warehouseID,
			"release_error", releaseErr,
			"publish_error", publishErr,
		)

		return
	}

	slog.ErrorContext(ctx, "order create failed after its stock take: the direct release went through, but its "+
		"InventoryTxCancel backup was not published",
		"idempotency_key", p.idempotencyKey,
		"team_id", p.teamID,
		"error", publishErr,
	)
}

// errOrderOutcomeUnknown is what a person hears when the order's commit reported an error AND the read that would have told
// whether it landed failed too (backlog #10c): nothing was released, so placing it again may be refused as a used key —
// which is itself the answer that the first one went through.
var errOrderOutcomeUnknown = errors.New("the order may or may not have been placed — the connection to the database " +
	"broke as it was saved; open the order list to check before placing it again")

// placedOrderByKey is the order filed under key K, with its lines, or nil when none is (backlog #10c) — the question a
// commit that reported an error leaves open. A FRESH read on the service's own handle, never the failed transaction's,
// and under a context the person leaving cannot cancel: it decides whether stock is released.
//
// By K alone, never also by team: K is unique across every order (the-idempotency-key-is-unique) and the take filed under
// it was THIS placement's — a second take under K is refused KEY_USED — so an order holding K is the one just committed.
func (s *Service) placedOrderByKey(ctx context.Context, key string) (*selling_service_models.Order, error) {
	var order selling_service_models.Order

	found := s.db.
		WithContext(context.WithoutCancel(ctx)).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("id ASC")
		}).
		Where("idempotency_key = ?", key).
		Limit(1).
		Find(&order)
	if found.Error != nil {
		return nil, found.Error
	}

	if found.RowsAffected == 0 {
		return nil, nil
	}

	return &order, nil
}

// isKeyUsedRefusal reports whether the take refused because its key is ALREADY USED — AlreadyExists carrying inventory's
// OrderTransactionRefusal with KEY_USED. The one failure after the take that is never compensated
// (a-used-key-is-never-cancelled): the key is another submit's live take.
//
// It reads the detail's reason, not the code alone: an AlreadyExists without that detail is some other answer, and
// treating it as "someone else's key" would leave a take nobody releases.
func isKeyUsedRefusal(err error) bool {
	var answered *connect.Error
	if !errors.As(err, &answered) || answered.Code() != connect.CodeAlreadyExists {
		return false
	}

	for _, detail := range answered.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}

		refusal, ok := value.(*inventoryv1.OrderTransactionRefusal)
		if ok && refusal.GetReason() == inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED {
			return true
		}
	}

	return false
}

// transactionIDOrNil is the take's transaction as the order stores it — nil (none recorded) for a take that named none,
// which only a test's fake does.
func transactionIDOrNil(id uint64) *uint64 {
	if id == 0 {
		return nil
	}

	return &id
}
