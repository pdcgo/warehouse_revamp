//go:build perfaudit

// Performance audit for LiabilityLogList (the audit-rpc-performance skill).
//
// WHY THIS RPC, NOW. Backlog #34 moved the pair page's date range and Receivable / Payable cut onto the server, before
// the page. Both are predicates the pair index `(team_id, counterparty_id, id DESC)` does not hold, so the count and
// the page now read the heap for every row of the pair the predicate rejects — this probe sizes that over a pair with
// 50 000 movements across 400 days, the volume of a busy warehouse and seller trading for a year.
//
//	go test -tags perfaudit -run TestPerf_LiabilityLogList -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func TestPerf_LiabilityLogList(t *testing.T) {
	base := san_testdb.DB(t)

	// The measured pair, both legs, plus nine other counterparties of the warehouse as busy as it.
	for counterparty := selling; counterparty < selling+10; counterparty++ {
		err := base.Exec(`
INSERT INTO liability_logs (team_id, counterparty_id, amount, source_type, source_id, reversal, group_id, balance_after, created_at)
SELECT ?, ?, CASE WHEN g % 4 = 0 THEN -(500 + g % 97) ELSE 1000 + g % 97 END,
       'order_fee', g, FALSE, g, 0,
       TIMESTAMPTZ '2026-01-01 00:00:00+07' + (g * 400 / 50000) * INTERVAL '1 day' + (g % 1440) * INTERVAL '1 minute'
FROM generate_series(1, 50000) AS g`, warehouse, counterparty).Error
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

	for _, c := range []struct {
		name   string
		filter *liabilityv1.LiabilityLogListFilter
	}{
		{"unfiltered", &liabilityv1.LiabilityLogListFilter{}},
		{"one week, mid-year", &liabilityv1.LiabilityLogListFilter{From: "2026-07-01", To: "2026-07-07"}},
		{"the oldest week", &liabilityv1.LiabilityLogListFilter{From: "2026-01-01", To: "2026-01-07"}},
		{"payable", &liabilityv1.LiabilityLogListFilter{Direction: liabilityv1.LiabilityLogDirection_LIABILITY_LOG_DIRECTION_PAYABLE}},
		{"one month, receivable", &liabilityv1.LiabilityLogListFilter{
			From: "2026-03-01", To: "2026-03-31",
			Direction: liabilityv1.LiabilityLogDirection_LIABILITY_LOG_DIRECTION_RECEIVABLE,
		}},
	} {
		c.filter.CounterpartyId = selling

		measure(t, base, probe, "LiabilityLogList "+c.name, 4, func() error {
			_, err := svc.LiabilityLogList(context.Background(), connect.NewRequest(&liabilityv1.LiabilityLogListRequest{
				TeamId: warehouse,
				Filter: c.filter,
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
			}))

			return err
		})
	}
}

// measure runs one call five times, logs the median and each query with its plan, and fails when the call issues more
// queries than `most` — a number that grew with the rows would be an N+1, the failure these probes exist to catch.
func measure(t *testing.T, base *gorm.DB, probe *san_perf.Probe, name string, most int, call func() error) {
	t.Helper()

	walls := []time.Duration{}

	for range 5 {
		probe.Reset()

		wall, _ := probe.Measure(func() {
			err := call()
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
		})

		walls = append(walls, wall)
	}

	queries := 0

	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
			continue
		}

		queries++

		t.Logf("  %s  %s", q.Duration, q.SQL)
		san_perf.Explain(t, base, q.SQL)
	}

	t.Logf("PERF %s median=%v queries=%d", name, san_perf.Median(walls), queries)

	if queries > most {
		t.Fatalf("%s: %d queries, want at most %d", name, queries, most)
	}
}
