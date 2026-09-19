package settlement_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
)

// eventLogRetention is how long a dedup row outlives its receipt — 45 days
// (#the-replay-cuts-three-tables-on-one-line).
//
// ⚠ IT MUST EXCEED THE BROKER'S RETENTION (31 days). A message still redeliverable after its dedup row is
// gone is folded TWICE, with no replay involved — so the two must never be the same number.
const eventLogRetention = 45 * 24 * time.Hour

// AnalyticMaintenanceRun prunes the dedup table (analytic_context.md §Idempotency Layer).
//
// ⚠ IT DOES NOT TAKE process_event_lock. It deletes rows received long ago while a live fold inserts a
// new one; the two cannot conflict, so there is nothing to block the webhook for — and a long lock window
// turns healthy messages into dead-lettered ones.
//
// ⚠ Cut on `created_at` — when the event was RECEIVED — never on `day`. A late event received today for a
// day last month must keep its guard for the whole redelivery window.
func (s *Service) AnalyticMaintenanceRun(
	ctx context.Context,
	_ *connect.Request[settlementv1.AnalyticMaintenanceRunRequest],
) (*connect.Response[settlementv1.AnalyticMaintenanceRunResponse], error) {
	cutoff := time.Now().Add(-eventLogRetention)

	result := s.db.WithContext(ctx).Exec(`DELETE FROM settlement_event_logs WHERE created_at < ?`, cutoff)
	if result.Error != nil {
		return nil, dbError(result.Error)
	}

	return connect.NewResponse(&settlementv1.AnalyticMaintenanceRunResponse{
		DeletedEventLogs: result.RowsAffected,
		Cutoff:           cutoff.Format(time.RFC3339),
	}), nil
}
