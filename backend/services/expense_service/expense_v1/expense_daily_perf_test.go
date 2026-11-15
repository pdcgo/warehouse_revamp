//go:build perfaudit

// Performance audit for ExpenseDaily at its three grains (the audit-rpc-performance skill), now that the SERVER groups
// (periods-are-grouped-on-the-server): a busy team three years deep — 50 rows a day, 2024-01-01 to 2026-12-31, 54 800
// rows — among nine more teams as deep (548 000 rows), so the team filter is as selective as a real table's.
//
//	go test -tags perfaudit -p 1 -run TestPerf_ExpenseDaily -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// seedExpenseDailyVolume writes the probe's rows in one statement per team: 50 a day for 1 096 days, the kinds
// PAYROLL / OPERATIONAL / OTHER / STOCK_LOSS in turn, fractional amounts so the sums are real doubles.
func seedExpenseDailyVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	for team := teamA; team < teamA+10; team++ {
		err := db.Exec(`
INSERT INTO expense_records (team_id, shop_id, kind, amount, occurred_at, note, created_by, finance_account_id)
SELECT ?, 0, 2 + (g % 4), 1000 + (g % 997) + 0.25, DATE '2024-01-01' + (g / 50), 'perf', 1, ?
FROM generate_series(0, 54799) AS g`, team, payingAccount).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	err := db.Exec(`ANALYZE expense_records`).Error
	if err != nil {
		t.Fatal(err)
	}
}

type expenseDailyCase struct {
	name     string
	from, to string
	grain    analytic_basev1.GroupType
}

// The screen's reads: a year read by day (Harian at its longest), the same year by month (Bulanan), and three years by
// year (Tahunan) — the span the grain unlocks.
var expenseDailyCases = []expenseDailyCase{
	{"a year, daily", "2026-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_DAILY},
	{"a year, monthly", "2026-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_MONTHLY},
	{"three years, yearly", "2024-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_YEARLY},
}

func TestPerf_ExpenseDaily(t *testing.T) {
	base := san_testdb.DB(t)
	seedExpenseDailyVolume(t, base)

	db, probe := san_perf.Wrap(base)
	svc := newService(t, db)
	ctx := t.Context()

	for _, c := range expenseDailyCases {
		walls := []time.Duration{}
		rows := 0

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(func() {
				res, err := svc.ExpenseDaily(ctx, connect.NewRequest(&expensev1.ExpenseDailyRequest{
					TeamId:  teamA,
					Filter:  &expensev1.ExpenseDailyFilter{From: c.from, To: c.to},
					GroupBy: c.grain,
				}))
				if err != nil {
					t.Fatalf("%s: %v", c.name, err)
				}

				rows = len(res.Msg.GetDays())
			})

			walls = append(walls, wall)
		}

		t.Logf("PERF ExpenseDaily %s: median=%v queries=%d rows=%d", c.name, san_perf.Median(walls), probe.Count(), rows)

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			t.Logf("  %s  %s", q.Duration, q.SQL)
			san_perf.Explain(t, base, q.SQL)
		}

		// The grouped read and the period totals — the same two queries at every grain.
		if probe.Count() != 2 {
			t.Fatalf("%s: %d queries, want the grouped read and the totals", c.name, probe.Count())
		}
	}
}
