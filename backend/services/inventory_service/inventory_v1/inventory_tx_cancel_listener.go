package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// InventoryTxCancel is the listener for the order service's compensation of a failed create
// (the-compensation-event-is-inventory-tx-cancel): release whatever was taken under the event's key.
//
// It is the BACKUP of the order's direct release (the-release-is-direct-then-the-event), so it usually finds the take
// already released, and that is a no-op acknowledged like any other (every-release-goes-by-the-key). It runs the very
// release OrderTransactionRelease runs — releaseByKey, team-checked (the-cancel-event-names-the-team):
//
//   - taken → rolled back, once; a redelivery finds it released and does nothing;
//   - not seen yet → K claimed with none, so a take that arrives late is refused as a used key;
//   - another team's take → ACKNOWLEDGED AND LOGGED, never released: redelivering it would never succeed;
//   - a rack a stock count holds → an ERROR, so the broker redelivers until the count ends
//     (a-cancel-still-meets-the-count-first), and the dead-letter catches it after the retry limit;
//   - the database failing → an error, redelivered.
//
// No event_id claim: the release is idempotent by its key, which is all a redelivery needs. The actor is the
// variant's — who placed the failed order — never the envelope's identity (identity-is-a-record-never-a-credential).
func (s *Service) InventoryTxCancel(ctx context.Context, cancel *eventsv1.InventoryTxCancel) error {
	key := cancel.GetIdempotencyKey()

	res, err := s.releaseByKey(ctx, cancel.GetTeamId(), key, cancel.GetActorId())
	if err != nil {
		if errors.Is(err, errOrderTransactionMissing) {
			slog.WarnContext(ctx, "InventoryTxCancel names a take of another team — acknowledged, nothing released",
				slog.String("idempotency_key", key),
				slog.Uint64("team_id", cancel.GetTeamId()),
				slog.Uint64("warehouse_id", cancel.GetWarehouseId()),
			)

			return nil
		}

		if refused := countedRefusal(err); refused != nil {
			return fmt.Errorf("InventoryTxCancel %s waits for the stock count: %w", key, refused)
		}

		return fmt.Errorf("InventoryTxCancel %s: %w", key, err)
	}

	slog.InfoContext(ctx, "InventoryTxCancel handled",
		slog.String("idempotency_key", key),
		slog.Uint64("team_id", cancel.GetTeamId()),
		slog.Uint64("transaction_id", res.GetTransactionId()),
		slog.Bool("released", res.GetReleased()),
		slog.String("reason", cancel.GetReason()),
	)

	return nil
}
