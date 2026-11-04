package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// OrderCancelled is inventory's listener for a cancelled order: put its stock back, by the order's key K
// (inventory-returns-stock-on-order-cancelled, every-release-goes-by-the-key). The cancel no longer releases inside its
// own flow — it checks the count first, moves the status, and announces this.
//
// It runs the very release OrderTransactionRelease and InventoryTxCancel run — releaseByKey, team-checked against the
// event's team (the-cancel-event-names-the-team):
//
//   - taken → rolled back, once; a redelivery (or a late InventoryTxCancel on the same K) finds it released and does
//     nothing;
//   - no key → an order that never took stock: ACKNOWLEDGED, nothing to release;
//   - another team's take → acknowledged and logged, never released: redelivering it would never succeed;
//   - a rack a stock count holds → an ERROR, so the broker redelivers until the count ends
//     (a-cancel-still-meets-the-count-first) — the cancel that slipped past the order's count check, a race;
//   - the database failing → an error, redelivered.
//
// No event_id claim: the release is idempotent by its key. The actor is the variant's — who cancelled the order — so the
// rollback's ledger rows name them (identity-is-a-record-never-a-credential).
func (s *Service) OrderCancelled(ctx context.Context, cancelled *eventsv1.OrderCancelled) error {
	key := cancelled.GetIdempotencyKey()
	if key == "" {
		slog.InfoContext(ctx, "OrderCancelled names no key — an order that never took stock, nothing to release",
			slog.Uint64("order_id", cancelled.GetOrderId()),
			slog.Uint64("team_id", cancelled.GetTeamId()),
		)

		return nil
	}

	res, err := s.releaseByKey(ctx, cancelled.GetTeamId(), key, cancelled.GetActorId())
	if err != nil {
		if errors.Is(err, errOrderTransactionMissing) {
			slog.WarnContext(ctx, "OrderCancelled names a take of another team — acknowledged, nothing released",
				slog.String("idempotency_key", key),
				slog.Uint64("order_id", cancelled.GetOrderId()),
				slog.Uint64("team_id", cancelled.GetTeamId()),
				slog.Uint64("warehouse_id", cancelled.GetWarehouseId()),
			)

			return nil
		}

		if refused := countedRefusal(err); refused != nil {
			return fmt.Errorf("OrderCancelled %d (%s) waits for the stock count: %w", cancelled.GetOrderId(), key, refused)
		}

		return fmt.Errorf("OrderCancelled %d (%s): %w", cancelled.GetOrderId(), key, err)
	}

	slog.InfoContext(ctx, "OrderCancelled handled",
		slog.Uint64("order_id", cancelled.GetOrderId()),
		slog.String("idempotency_key", key),
		slog.Uint64("team_id", cancelled.GetTeamId()),
		slog.Uint64("transaction_id", res.GetTransactionId()),
		slog.Bool("released", res.GetReleased()),
	)

	return nil
}
