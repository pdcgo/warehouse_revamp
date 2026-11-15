//go:build perfaudit

// Performance audit for LiabilityDaily (the audit-rpc-performance skill).
//
// WHY THIS RPC, NOW. periods-are-grouped-on-the-server moved the month and the year onto the server: the grouping key
// is the Jakarta day's month or year (`date_trunc` over `(created_at AT TIME ZONE 'Asia/Jakarta')::date`), and the span
// a grain may read grew to 60 months and 20 years. The bounds still filter the raw `created_at`, so the access path
// should be the one the daily read had — this probe is the proof, over three years of a busy warehouse's fees.
// (Earlier: the-liability-day-is-the-jakarta-day moved the day itself to the Jakarta calendar.)
//
// The volume: a busy warehouse three years deep — 100 000 legs — among 19 other teams (575 000 legs), interleaved in time.
//
//	go test -tags perfaudit -p 1 -run TestPerf_LiabilityDaily -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// seedLiabilityDailyVolume writes a busy warehouse's three years (2024–2026): 100 000 legs, ~91 a day, spread over 50
// counterparties and two sources — plus 25 000 legs for each of 19 other teams (575 000 rows), the legs of every team
// INTERLEAVED in time as a live ledger's are, so a team's rows are spread over the whole table.
func seedLiabilityDailyVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	err := db.Exec(`
INSERT INTO liability_logs (team_id, counterparty_id, amount, source_type, source_id, reversal, group_id, balance_after, created_at)
SELECT CASE WHEN g % 23 < 4 THEN ? ELSE ? + 1 + (g % 19) END,
       2000 + (g % 50), 1000 + (g % 97) + 0.5,
       CASE WHEN g % 3 = 0 THEN 'incidental_fee' ELSE 'order_fee' END,
       g, FALSE, g, 0,
       TIMESTAMPTZ '2024-01-01 00:00:00+07' + (g * INTERVAL '1 day' * 1096 / 575000) + (g % 1440) * INTERVAL '1 minute'
FROM generate_series(1, 575000) AS g`, warehouse, warehouse).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	err = db.Exec(`ANALYZE liability_logs`).Error
	if err != nil {
		t.Fatal(err)
	}
}

type liabilityDailyCase struct {
	name     string
	from, to string
	grain    analytic_basev1.GroupType
}

// The screen's reads: a month and a year read by day (Harian), the year by month (Bulanan), three years by year
// (Tahunan) — the span the grain unlocks.
var liabilityDailyCases = []liabilityDailyCase{
	{"a month, daily", "2026-07-01", "2026-07-31", analytic_basev1.GroupType_GROUP_TYPE_DAILY},
	{"a year, daily", "2026-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_DAILY},
	{"a year, monthly", "2026-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_MONTHLY},
	{"three years, yearly", "2024-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_YEARLY},
}

func TestPerf_LiabilityDaily(t *testing.T) {
	base := san_testdb.DB(t)
	seedLiabilityDailyVolume(t, base)

	db, probe := san_perf.Wrap(base)
	svc := liability_v1.NewService(db, nil, nil, nil)
	ctx := context.Background()

	for _, c := range liabilityDailyCases {
		walls := []time.Duration{}
		rows := 0

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(func() {
				res, err := svc.LiabilityDaily(ctx, connect.NewRequest(&liabilityv1.LiabilityDailyRequest{
					TeamId:  warehouse,
					Filter:  &liabilityv1.LiabilityDailyFilter{From: c.from, To: c.to},
					GroupBy: c.grain,
				}))
				if err != nil {
					t.Fatalf("LiabilityDaily %s: %v", c.name, err)
				}

				rows = len(res.Msg.GetDays())
			})

			walls = append(walls, wall)
		}

		t.Logf("PERF LiabilityDaily %s: median=%v queries=%d rows=%d", c.name, san_perf.Median(walls), probe.Count(), rows)

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			t.Logf("  %s  %s", q.Duration, q.SQL)
			san_perf.Explain(t, base, q.SQL)
		}

		if probe.Count() != 1 {
			t.Fatalf("%d queries, want the one grouped query", probe.Count())
		}
	}
}
