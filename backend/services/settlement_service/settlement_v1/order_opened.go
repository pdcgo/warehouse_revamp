package settlement_v1

import (
	"context"
	"log/slog"
	"time"
)

// OrderOpenedMarker tells the ORDER that its settlement account opened (a-missing-account-is-found-by-its-opened-at):
// `orders.settlement_opened_at`, the order service's own column, which its list filters on to find the orders whose
// account never opened. An interface settlement owns, answered at the composition root by the order service's
// in-process method (settlement_opened_marker.go) — so settlement never imports selling, and never writes its table.
//
// Stamping is idempotent on the other side: the first opening wins, a second is a no-op.
type OrderOpenedMarker interface {
	SettlementOpened(ctx context.Context, orderID uint64, openedAt time.Time) error
}

// noOrderOpened is a settlement with no order service to tell — tests, and nothing else.
type noOrderOpened struct{}

func (noOrderOpened) SettlementOpened(context.Context, uint64, time.Time) error { return nil }

// markOpened stamps the order's opening after a COMMITTED `initial_total` — the first, or an idempotent hit on it.
//
// ⚠ AFTER THE COMMIT, AND NEVER FATAL, as the publish beside it (no-outbox-the-publish-is-trusted): the ledger row is
// the truth, and the order still commits when its account does not open, so neither may fail on the stamp. A failed
// stamp leaves the order reading "not opened" — the safe side: a person checks it and finds the account there — and is
// repaired by re-posting the same unique_id (a redelivered Order Placed does exactly that), which stamps it again.
// The time is the row's own `created_at`, identical on every retry — truncated to the microsecond, as the driver sends
// it and Postgres stores it, so the first post (holding Go's nanoseconds) and a retry (reading the stored row) name the
// same moment.
func (s *Service) markOpened(ctx context.Context, result PostResult) {
	entry := result.Entry
	if entry.SettlementType != typeInitialTotal || entry.OrderID == nil {
		return
	}

	err := s.opened.SettlementOpened(ctx, *entry.OrderID, entry.CreatedAt.Truncate(time.Microsecond))
	if err != nil {
		slog.ErrorContext(ctx, "settlement account opened but the order was not stamped — "+
			"re-post the same unique_id to stamp it",
			"order_id", *entry.OrderID,
			"unique_id", entry.UniqueID,
			"error", err,
		)
	}
}
