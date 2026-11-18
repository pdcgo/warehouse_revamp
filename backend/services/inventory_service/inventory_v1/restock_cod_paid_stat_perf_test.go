//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE COD CARD AT VOLUME (the-warehouse-sees-the-cod-it-paid). 50 000 restocks into ONE warehouse over four years —
// nine in ten accepted, half of those with a courier's charge — beside 50 000 more into nine other warehouses: 100 000
// `restocks`. RestockCodPaidStat is timed over this month (what the card asks), a year, and the whole four years —
// first with 00051's pure index `restocks_warehouse_accepted_at_idx (warehouse_id, accepted_at) WHERE accepted_at IS NOT
// NULL` dropped, then with it put back, on the same seed (a-pure-index-is-added-without-asking: the before/after).
func TestPerf_RestockCodPaidStat(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	const warehouse uint64 = 905

	err := quiet.Exec(`
		INSERT INTO restocks (team_id, warehouse_id, status, shipment_cost, subtotal, total,
		                      warehouse_additional_cost, warehouse_additional_cost_note, accepted_at, created_at, updated_at)
		SELECT 2 + g % 40,
		       CASE WHEN g <= 50000 THEN 905 ELSE 906 + g % 9 END,
		       CASE WHEN g % 10 = 0 THEN 'ongoing' ELSE 'accepted' END,
		       25000, 1000000, 1025000,
		       CASE WHEN g % 10 <> 0 AND g % 2 = 0 THEN 5000 + (g % 7) * 1000 ELSE 0 END,
		       CASE WHEN g % 10 <> 0 AND g % 2 = 0 THEN 'courier at the door' ELSE '' END,
		       CASE WHEN g % 10 = 0 THEN NULL ELSE NOW() - ((g % 1461) * INTERVAL '1 day') - (g % 86400) * INTERVAL '1 second' END,
		       NOW() - ((g % 1461) * INTERVAL '1 day') - INTERVAL '2 days',
		       NOW()
		FROM generate_series(1, 100000) g`).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	err = quiet.Exec("ANALYZE restocks").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	svc := newService(t, db)

	// BEFORE 00051 — its index dropped inside the test's own transaction (rolled back with the seed).
	err = quiet.Exec("DROP INDEX restocks_warehouse_accepted_at_idx").Error
	if err != nil {
		t.Fatalf("drop 00051's index: %v", err)
	}

	perfCodRuns(t, db, probe, svc, warehouse, "before 00051")

	err = quiet.Exec(`CREATE INDEX restocks_warehouse_accepted_at_idx ON restocks (warehouse_id, accepted_at)
		WHERE accepted_at IS NOT NULL`).Error
	if err != nil {
		t.Fatalf("00051's index: %v", err)
	}

	err = quiet.Exec("ANALYZE restocks").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	perfCodRuns(t, db, probe, svc, warehouse, "with 00051")
}

func perfCodRuns(t *testing.T, db *gorm.DB, probe *san_perf.Probe, svc *inventory_v1.Service, warehouse uint64, label string) {
	ctx := ctxUser(7)
	now := time.Now()
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	for _, c := range []struct {
		name     string
		from, to time.Time
	}{
		{"this month", month, now},
		{"a year", now.AddDate(-1, 0, 0), now},
		{"four years", now.AddDate(-4, 0, 0), now},
	} {
		req := &inventoryv1.RestockCodPaidStatRequest{TeamId: warehouse, FromUnix: c.from.Unix(), ToUnix: c.to.Unix()}

		res, err := svc.RestockCodPaidStat(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.RestockCodPaidStat(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s: %s wall=%v db=%v queries=%d", label, c.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s: %s MEDIAN wall %v — %d restocks, Rp %.0f", label, c.name, san_perf.Median(walls),
			res.Msg.GetRestockCount(), res.Msg.GetAmount())

		for _, query := range probe.Queries() {
			if strings.HasPrefix(query.SQL, "SAVEPOINT") || strings.HasPrefix(query.SQL, "RELEASE") {
				continue
			}

			san_perf.Explain(t, db, query.SQL)
		}
	}
}
