//go:build perfaudit

// Performance audit for LiabilityDaily (the audit-rpc-performance skill).
//
// WHY THIS RPC, NOW. the-liability-day-is-the-jakarta-day moved its grouping key to
// `(created_at AT TIME ZONE 'Asia/Jakarta')::date` and its bounds to Jakarta midnights. The bounds still filter the
// raw `created_at`, so the plan should be the one it had — this probe is the proof, over a year of a busy warehouse's
// fees.
//
//	go test -tags perfaudit -run TestPerf_LiabilityDaily -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func TestPerf_LiabilityDaily(t *testing.T) {
	base := san_testdb.DB(t)

	// 50 000 legs for the warehouse over 400 days, spread over 50 counterparties and two sources — the skill's volume
	// for a log — plus as many for each of nine other teams, so the team filter is as selective as a real ledger's.
	for teamID := warehouse; teamID < warehouse+10; teamID++ {
		err := base.Exec(`
INSERT INTO liability_logs (team_id, counterparty_id, amount, source_type, source_id, reversal, group_id, balance_after, created_at)
SELECT ?, 2000 + (g % 50), 1000 + (g % 97),
       CASE WHEN g % 3 = 0 THEN 'incidental_fee' ELSE 'order_fee' END,
       g, FALSE, g, 0,
       TIMESTAMPTZ '2026-01-01 00:00:00+07' + (g % 400) * INTERVAL '1 day' + (g % 1440) * INTERVAL '1 minute'
FROM generate_series(1, 50000) AS g`, teamID).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	err := base.Exec(`ANALYZE liability_logs`).Error
	if err != nil {
		t.Fatal(err)
	}

	db, probe := san_perf.Wrap(base)
	svc := liability_v1.NewService(db, nil, nil, nil)
	ctx := context.Background()

	for _, period := range []struct{ from, to string }{{"2026-07-01", "2026-07-31"}, {"2026-01-01", "2026-12-31"}} {
		walls := []time.Duration{}

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(func() {
				_, err := svc.LiabilityDaily(ctx, connect.NewRequest(&liabilityv1.LiabilityDailyRequest{
					TeamId: warehouse,
					Filter: &liabilityv1.LiabilityDailyFilter{From: period.from, To: period.to},
				}))
				if err != nil {
					t.Fatalf("LiabilityDaily: %v", err)
				}
			})

			walls = append(walls, wall)
		}

		t.Logf("PERF LiabilityDaily %s..%s median=%v queries=%d", period.from, period.to, san_perf.Median(walls), probe.Count())

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			t.Logf("  %s  %s", q.Duration, q.SQL)

			// The plan now, and the plan of the UTC grouping it replaced — the bounds are the same shape either way.
			san_perf.Explain(t, base, q.SQL)
			san_perf.Explain(t, base, strings.Replace(q.SQL, "AT TIME ZONE 'Asia/Jakarta'", "AT TIME ZONE 'UTC'", 1))
		}

		if probe.Count() != 1 {
			t.Fatalf("%d queries, want the one grouped query", probe.Count())
		}
	}
}
