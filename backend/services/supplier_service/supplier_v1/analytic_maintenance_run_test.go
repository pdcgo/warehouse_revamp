package supplier_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// The prune cuts dedup rows RECEIVED more than 45 days ago — on created_at, never on the accept's day — and leaves the
// figures and the backfill's cutoff alone.
func TestAnalyticMaintenanceRun_PrunesOldDedupRowsOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, accept(1, sellingA, 31, "2026-01-01", line{product: 100, ordered: 1, total: 1000, accepted: 1}))
	fold(t, svc, accept(2, sellingA, 31, "2026-01-01", line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	// Restock 1's claim was received 50 days ago; restock 2's just now — though both accepts are on the same old day.
	err := db.Exec(`UPDATE supplier_event_logs SET created_at = ? WHERE id = 'restock-accepted:1'`,
		time.Now().Add(-50*24*time.Hour)).Error
	if err != nil {
		t.Fatalf("age the claim: %v", err)
	}

	resp, err := svc.AnalyticMaintenanceRun(context.Background(), connect.NewRequest(&supplierv1.AnalyticMaintenanceRunRequest{}))
	if err != nil {
		t.Fatalf("maintenance: %v", err)
	}

	if resp.Msg.GetDeletedEventLogs() != 1 {
		t.Fatalf("pruned %d dedup rows, want 1", resp.Msg.GetDeletedEventLogs())
	}

	if n := countRows(t, db, &supplier_service_models.SupplierEventLog{}); n != 1 {
		t.Fatalf("%d dedup rows left, want 1 — cut on the accept's day, not on receipt", n)
	}

	if got := figureRow(t, db, "2026-01-01", 31, 100, sellingA); got.RestockCount != 2 {
		t.Fatalf("the figures changed: %+v", got)
	}

	if metadata(t, db, supplier_service_models.MetadataFiguresLiveSince) == "" {
		t.Fatal("the prune touched figures_live_since")
	}
}
