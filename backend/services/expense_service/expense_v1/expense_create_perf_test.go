//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ExpenseCreate -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// ExpenseCreate and ExpenseAdjust once *Paid from* is stored and published — a team three years deep in expenses (20 000
// rows). The account check is the composition root's in-process ByIds call (one indexed read, audited with
// FinancialAccountByIds); here it is the fake, so what is measured is expense_service's own queries.
func TestPerf_ExpenseCreate(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	rows := make([]expense_service_models.ExpenseRecord, 0, 20_000)
	start := time.Date(2023, 11, 1, 0, 0, 0, 0, time.UTC)

	for i := range 20_000 {
		rows = append(rows, expense_service_models.ExpenseRecord{
			TeamID: teamA, Kind: int32(1 + i%4), Amount: int64(10_000 + i), OccurredAt: start.AddDate(0, 0, i%1_090),
			CreatedBy: 1, FinanceAccountID: payingAccount, CreatedAt: time.Now(), UpdatedAt: time.Now(),
		})
	}

	san_perf.SeedRows(t, db, rows)

	err := db.Exec("ANALYZE expense_records").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	sent := &sentEvents{}
	svc := newServiceSending(t, db, sent)
	ctx := t.Context()

	var lastExpense uint64

	calls := []struct {
		name string
		call func() error
	}{
		{"ExpenseCreate ads", func() error {
			res, err := svc.ExpenseCreate(ctx, connect.NewRequest(&expensev1.ExpenseCreateRequest{
				TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Amount: 250_000, OccurredAt: "2026-10-30",
				ShopId: adsShop, FinanceAccountId: payingAccount,
			}))
			if err == nil {
				lastExpense = res.Msg.GetExpense().GetId()
			}

			return err
		}},
		{"ExpenseAdjust", func() error {
			_, err := svc.ExpenseAdjust(ctx, connect.NewRequest(&expensev1.ExpenseAdjustRequest{
				TeamId: teamA, ExpenseId: lastExpense, Amount: -1_000,
			}))

			return err
		}},
	}

	for _, c := range calls {
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = c.call() })
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", c.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", c.name, san_perf.Median(walls))

		for _, q := range probe.Queries() {
			// The transaction's own SAVEPOINT / RELEASE (the test runs inside one) have no plan.
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}

	if len(sent.events) != 10 {
		t.Fatalf("%d events published, want 10 — one per create and per adjustment", len(sent.events))
	}
}
