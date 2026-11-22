//go:build raceaudit

// Concurrency audit for the expense types on the account (the-expense-types-prototype-is-accepted): the listener's write
// path now posts `money_in` and `capital` rows and stamps each with its expense — still the ledger's one lock rule (the
// account FOR UPDATE) and the event claim beside the post. Money in, a Prive, a Setoran modal and their corrections
// racing a hand Setor Modal on the same account lose nothing, never deadlock, and every row names its expense.
//
//	go test -tags raceaudit -run 'TestRace_ExpenseTypes' -count=1 -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"fmt"
	"testing"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

func TestRace_ExpenseTypes_MoneyInAndCapitalBesideAHandCapitalOnTheSameAccount(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops, nil, nil)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "E000401", 1_000_000))

	other := expensev1.ExpenseKind_EXPENSE_KIND_OTHER

	res := h.Race(t, 10, func(i int) error {
		id := fmt.Sprintf("race-typed-%d", i)

		switch i % 5 {
		case 0: // money in, +50.000
			return payExpense(svc, typedCreated(id, x.GetId(), other, expensev1.ExpenseType_EXPENSE_TYPE_OTHER_IN, 50_000))
		case 1: // a prive, −30.000
			return payExpense(svc, typedCreated(id, x.GetId(), other, expensev1.ExpenseType_EXPENSE_TYPE_PRIVE, 30_000))
		case 2: // a setoran modal, +20.000
			return payExpense(svc, typedCreated(id, x.GetId(), other, expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT, 20_000))
		case 3: // a money-in reduced by 10.000 — −10.000
			return payExpense(svc, typedAdjusted(id, x.GetId(), other, expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_RECEIVABLE_RECEIVED, -10_000))
		default: // a Setor Modal by hand, +1.000
			return capitalIn(svc, x.GetId(), 1_000)
		}
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d calls failed", res.Failed())
	}

	// Two of each: +100.000 −60.000 +40.000 −20.000 +2.000 = +62.000.
	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 1_062_000 {
		t.Fatalf("balance = %v, want 1062000 — a move was lost", got)
	}

	var rows []m.FinancialAccountLog

	err := h.DB().
		Where("account_id = ?", x.GetId()).
		Order("id").
		Find(&rows).
		Error
	if err != nil {
		t.Fatal(err)
	}

	running := 0.0
	fromExpenses := 0

	for _, r := range rows {
		running += r.Change
		if r.BalanceAfter != running {
			t.Fatalf("row %d balance_after %v, the chain says %v", r.ID, r.BalanceAfter, running)
		}

		if r.ExpenseID != 0 {
			fromExpenses++
		}
	}

	if fromExpenses != 8 {
		t.Fatalf("%d rows name an expense, want the 8 the listener posted", fromExpenses)
	}
}
