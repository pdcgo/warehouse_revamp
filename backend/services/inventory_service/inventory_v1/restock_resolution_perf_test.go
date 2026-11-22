//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE RESOLUTION COUNTS ON A LIST PAGE (backlog #101): `withResolutionCounts` is ONE grouped statement per page on
// `restock_resolutions_restock_key` (restock_id leads it). The problem book's 50 000 restocks with resolution rows on
// every accepted one carrying a problem and every lost one (1–3 each, ~40 000 rows) — the page's count read is an index
// scan, never a seq scan of the table.
//
//	go test -tags perfaudit -p 1 -count=1 -run TestPerf_RestockRequestListResolutionCounts -v ./backend/services/inventory_service/inventory_v1/
func TestPerf_RestockRequestListResolutionCounts(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfProblemBook(t, db)

	err := db.Exec(`
		INSERT INTO restock_resolutions (restock_id, resolution_type, refund_amount, finance_account_id, idempotency_key)
		SELECT r.id, 'refund', 1000, 7, 'perf-' || r.id || '-' || n
		FROM restocks r
		CROSS JOIN LATERAL generate_series(1, 1 + (r.id % 3)::int) AS n
		WHERE r.status = 'lost' OR EXISTS (SELECT 1 FROM restock_problem_items p WHERE p.restock_id = r.id)`).Error
	if err != nil {
		t.Fatalf("seed resolutions: %v", err)
	}

	var rows int64
	db.Raw(`SELECT COUNT(*) FROM restock_resolutions`).Scan(&rows)
	db.Exec(`ANALYZE restock_resolutions`)
	t.Logf("seeded %d resolution rows", rows)

	svc := newService(t, db)
	ctx := ctxUser(7)

	for _, c := range perfProblemCases() {
		res, err := svc.RestockRequestList(ctx, connect.NewRequest(c.req))
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		counted := 0

		for _, item := range res.Msg.GetItems() {
			for _, r := range item.GetRestockRequest().GetMapData() {
				if r.GetResolutionCount() > 0 {
					counted++
				}
			}
		}

		walls := make([]time.Duration, 0, 5)
		queries := 0

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(func() {
				_, err = svc.RestockRequestList(ctx, connect.NewRequest(c.req))
			})
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			queries = probe.Count()
		}

		t.Logf("%s MEDIAN wall %v, %d queries, %d of %d rows with resolutions", c.name, san_perf.Median(walls), queries,
			counted, len(res.Msg.GetIds()))

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "restock_resolutions") {
				t.Logf("%s — the resolution counts, %v:", c.name, q.Duration)
				san_perf.Explain(t, db, q.SQL)
			}
		}
	}
}
