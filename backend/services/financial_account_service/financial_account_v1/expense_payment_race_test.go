//go:build raceaudit

// Concurrency audit for the expense-payment listener (the audit-sql skill). It keeps the ledger's one lock rule — the
// account FOR UPDATE — and claims the event id beside the post. These tests hold it to that: a redelivery racing the
// first delivery posts once, expenses and corrections racing a hand transfer on the same account lose nothing and never
// deadlock, and an expense post waits on a post already holding its account.
//
//	go test -tags raceaudit -run 'TestRace_ExpensePayment|TestInterleave_ExpensePayment' -count=1 -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"fmt"
	"testing"

	"gorm.io/gorm"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// The same expense delivered four times at once — Pub/Sub redelivering while the first still runs: it is paid ONCE.
func TestRace_ExpensePayment_OneEventFourDeliveries(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "E000301", 500_000))

	res := h.Race(t, 4, func(int) error {
		return payExpense(svc, expenseCreated("race-ec-same", x.GetId(), expensev1.ExpenseKind_EXPENSE_KIND_ADS, 120_000))
	})
	res.Report(t)

	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 380_000 {
		t.Fatalf("balance = %v — the expense was paid more than once", got)
	}
}

// Expenses out of X and corrections back into it, while a person transfers X → Y and Y → X, all at the same instant:
// no deadlock, no lost update — X ends exactly where the sum of every move says.
func TestRace_ExpensePayment_BesideHandTransfersOnTheSameAccount(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "E000311", 1_000_000))
	y := mustCreate(t, svc, cash(teamA, "Ops Cash", 1_000_000))

	payroll := expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL

	res := h.Race(t, 8, func(i int) error {
		switch i % 4 {
		case 0:
			return payExpense(svc, expenseCreated(fmt.Sprintf("race-ec-%d", i), x.GetId(), payroll, 10_000))
		case 1:
			return payExpense(svc, expenseAdjusted(fmt.Sprintf("race-ea-%d", i), x.GetId(), payroll, -4_000))
		case 2:
			return transfer(svc, teamA, x.GetId(), y.GetId(), 1_000, day(0))
		default:
			return transfer(svc, teamA, y.GetId(), x.GetId(), 2_000, day(0))
		}
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d calls failed", res.Failed())
	}

	// Two expenses −20.000, two corrections +8.000, two transfers out −2.000, two in +4.000: X −10.000, Y −2.000.
	bx, by := storedAccount(t, h.DB(), x.GetId()).Balance, storedAccount(t, h.DB(), y.GetId()).Balance
	if bx != 990_000 || by != 998_000 {
		t.Fatalf("X = %v, Y = %v — want 990000 and 998000", bx, by)
	}
}

// The PROOF: an expense out of an account a capital post already holds WAITS for it, then builds on its balance — the
// listener takes the same row lock every other write takes.
func TestInterleave_ExpensePayment_WaitsForAPostOnItsAccount(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "E000321", 500_000))

	sched := h.Interleave(t,
		san_race.Do("A", "A puts 1.000 of capital into the paying account", func(tx *gorm.DB) error {
			return capitalIn(on(tx), x.GetId(), 1_000)
		}),
		san_race.Block("B", "B posts a 120.000 expense out of the same account", func(tx *gorm.DB) error {
			return payExpense(on(tx), expenseCreated("interleave-ec", x.GetId(), expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 120_000))
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if !sched.Get("B posts a 120.000 expense out of the same account").Released {
		t.Fatal("B did not wait for A — the expense listener does not take the account lock")
	}

	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 381_000 {
		t.Fatalf("balance = %v — want 381000, the expense built on the capital's balance", got)
	}
}
