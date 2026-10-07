package supplier_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// eventLogRetention is how long a dedup row outlives its receipt — 45 days, settlement's number.
//
// ⚠ IT MUST EXCEED THE BROKER'S RETENTION (31 days). A message still redeliverable after its dedup row is gone is
// folded TWICE, with no replay involved — so the two must never be the same number.
const eventLogRetention = 45 * 24 * time.Hour

// AnalyticMaintenanceRun prunes the dedup table, `supplier_event_logs`.
//
// ⚠ IT DOES NOT TAKE process_event_lock. It deletes rows received long ago while a live fold inserts a new one; the two
// cannot conflict. ⚠ Cut on `created_at` — when the event was RECEIVED — never on `day`.
//
// The backfill does not depend on these rows outliving it: it skips every accept from `figures_live_since` on, a key
// this never touches (past-accepts-are-backfilled-once).
func (s *Service) AnalyticMaintenanceRun(
	ctx context.Context,
	_ *connect.Request[supplierv1.AnalyticMaintenanceRunRequest],
) (*connect.Response[supplierv1.AnalyticMaintenanceRunResponse], error) {
	cutoff := time.Now().Add(-eventLogRetention)

	result := s.db.WithContext(ctx).Exec(`DELETE FROM supplier_event_logs WHERE created_at < ?`, cutoff)
	if result.Error != nil {
		return nil, internal(result.Error)
	}

	return connect.NewResponse(&supplierv1.AnalyticMaintenanceRunResponse{
		DeletedEventLogs: result.RowsAffected,
		Cutoff:           cutoff.Format(time.RFC3339),
	}), nil
}
