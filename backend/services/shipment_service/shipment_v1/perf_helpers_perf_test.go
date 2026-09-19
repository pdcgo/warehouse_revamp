//go:build perfaudit

// Shared seeding and measuring for the shipment_service performance audits (the audit-rpc-performance
// skill). Each RPC's probe is in its own <rpc>_perf_test.go.
package shipment_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
)

// perfChannels is the reference-table volume the skill prescribes (200): a courier catalogue is
// curated and never approaches entity scale. Every 5th row is soft-deleted.
const perfChannels = 200

func perfSetup(t *testing.T, n int) (*gorm.DB, *san_perf.Probe, *shipment_v1.Service, []shipment_service_models.ShipmentChannel) {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))

	rows := make([]shipment_service_models.ShipmentChannel, 0, n)
	for i := range n {
		rows = append(rows, shipment_service_models.ShipmentChannel{
			Code:      fmt.Sprintf("courier_%05d", i),
			Name:      fmt.Sprintf("Courier %05d", i),
			Desc:      "seeded for the perf audit",
			IsDeleted: i%5 == 0,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		})
	}

	san_perf.SeedRows(t, db, &rows)

	return db, probe, shipment_v1.NewService(db), rows
}

// perfRun warms once (i = -1), then measures 5 runs and logs the median.
func perfRun(t *testing.T, probe *san_perf.Probe, name string, call func(i int) error) {
	t.Helper()

	err := call(-1)
	if err != nil {
		t.Fatalf("%s warm-up: %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)

	for i := range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			err = call(i)
		})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		walls = append(walls, wall)
		t.Logf("%s wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("%s median wall %v", name, san_perf.Median(walls))
	probe.Report(t, name)
}

// explainAll plans every query of the last measured run, on the test's own transaction. EXPLAIN
// ANALYZE executes a write too — harmless, the transaction rolls back.
func explainAll(t *testing.T, db *gorm.DB, probe *san_perf.Probe) {
	t.Helper()

	for _, q := range probe.Queries() {
		if strings.TrimSpace(q.SQL) == "" {
			continue
		}

		san_perf.Explain(t, db, q.SQL)
	}
}
