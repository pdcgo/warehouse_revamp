//go:build perfaudit

// Performance audit for ExpenseList with the expense types (the audit-rpc-performance skill): the screen's month read
// with no filter, a group (kind) and one type, and the all-time type read, on a busy team three years deep — 50 rows a
// day, 2024-01-01 to 2026-12-31, the 18 types and the old untyped rows in turn — among nine more teams as deep (548 000
// rows). Then the same reads with a candidate index on (team_id, type, occurred_at DESC, id DESC), created in the test's
// transaction, to see whether a pure index would gain anything (a-pure-index-is-added-without-asking: only with a
// measured gain).
//
//	go test -tags perfaudit -p 1 -run TestPerf_ExpenseListTypes -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// seedExpenseTypeVolume writes 54 800 rows per team: type g % 19 (0 = an old untyped row, kind OPERATIONAL) with its
// group as the kind — the fixed table's groups, as numbers.
func seedExpenseTypeVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	for team := teamA; team < teamA+10; team++ {
		err := db.Exec(`
INSERT INTO expense_records (team_id, shop_id, kind, type, amount, occurred_at, note, created_by, finance_account_id)
SELECT ?, CASE WHEN g % 19 = 1 THEN 77 ELSE 0 END,
       CASE WHEN g % 19 = 0 THEN 3 WHEN g % 19 <= 2 THEN 1 WHEN g % 19 <= 5 THEN 2 WHEN g % 19 <= 12 THEN 3 ELSE 4 END,
       g % 19, 1000 + (g % 997) + 0.25, DATE '2024-01-01' + (g / 50), 'perf', 1, ?
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

type expenseListTypeCase struct {
	name   string
	filter *expensev1.ExpenseListFilter
}

var expenseListTypeCases = []expenseListTypeCase{
	{"a month, everything", &expensev1.ExpenseListFilter{From: "2026-11-01", To: "2026-11-30"}},
	{"a month, one group", &expensev1.ExpenseListFilter{From: "2026-11-01", To: "2026-11-30", Kind: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL}},
	{"a month, one type", &expensev1.ExpenseListFilter{
		From: "2026-11-01", To: "2026-11-30", Kind: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL,
		Type: expensev1.ExpenseType_EXPENSE_TYPE_ELECTRICITY,
	}},
	{"all time, one type", &expensev1.ExpenseListFilter{Type: expensev1.ExpenseType_EXPENSE_TYPE_ELECTRICITY}},
}

func runExpenseListTypeCases(t *testing.T, label string, base *gorm.DB, svc *expense_v1.Service, probe *san_perf.Probe, explain bool) {
	t.Helper()

	for _, c := range expenseListTypeCases {
		walls := []time.Duration{}
		rows := 0

		for range 7 {
			probe.Reset()

			wall, _ := probe.Measure(func() {
				res, err := svc.ExpenseList(t.Context(), connect.NewRequest(&expensev1.ExpenseListRequest{
					TeamId: teamA, Filter: c.filter, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
				}))
				if err != nil {
					t.Fatalf("%s: %v", c.name, err)
				}

				rows = len(res.Msg.GetIds())
			})

			walls = append(walls, wall)
		}

		t.Logf("PERF ExpenseList [%s] %s: median=%v queries=%d rows=%d", label, c.name, san_perf.Median(walls), probe.Count(), rows)

		if !explain {
			continue
		}

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			t.Logf("  %s  %s", q.Duration, q.SQL)
			san_perf.Explain(t, base, q.SQL)
		}
	}
}

func TestPerf_ExpenseListTypes(t *testing.T) {
	base := san_testdb.DB(t)
	seedExpenseTypeVolume(t, base)

	db, probe := san_perf.Wrap(base)
	svc := newService(t, db)

	runExpenseListTypeCases(t, "today's indexes", base, svc, probe, true)

	// The candidate — a pure index, measured, never kept by this test (the transaction rolls back).
	err := base.Exec(`CREATE INDEX perf_expense_records_team_type_idx ON expense_records (team_id, type, occurred_at DESC, id DESC)`).Error
	if err != nil {
		t.Fatal(err)
	}

	err = base.Exec(`ANALYZE expense_records`).Error
	if err != nil {
		t.Fatal(err)
	}

	runExpenseListTypeCases(t, "with (team_id, type, occurred_at)", base, svc, probe, false)
}
