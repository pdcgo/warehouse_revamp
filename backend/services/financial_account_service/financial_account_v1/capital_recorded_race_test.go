//go:build raceaudit

// Concurrency audit for capital's second door on the account (prive-and-deposit-on-pengeluaran-are-the-accounts-capital):
// FinancialAccountCapital still posts its by-hand row under the ledger's one lock rule (the account FOR UPDATE), and now
// tells the broker AFTER its commit. Setor Modals at one instant beside expenses on the same account lose nothing, never
// deadlock, and each act is told once, naming its own row.
//
//	go test -tags raceaudit -run 'TestRace_CapitalDoor' -count=1 -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"sync"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

type lockedSent struct {
	mu     sync.Mutex
	events []*eventsv1.Event
}

func (s *lockedSent) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.events = append(s.events, event)

	return nil
}

// EIGHT SETOR MODALS AND FOUR EXPENSES ON ONE ACCOUNT AT ONE INSTANT: every row lands, the balance is their sum, and the
// broker hears exactly the eight acts — one message per by-hand row, none for the expenses, none twice.
func TestRace_CapitalDoor_SetorsBesideExpensesOnOneAccount(t *testing.T) {
	h := raceHarness(t)
	sent := &lockedSent{}
	svc := financial_account_v1.NewService(h.DB(), testShops, nil, sent.send)
	x := mustCreate(t, svc, bca(teamA, "Door BCA", "D000501", 1_000_000))

	ops := expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL

	res := h.Race(t, 12, func(i int) error {
		if i%3 == 2 {
			return payExpense(svc, typedCreated(fmt.Sprintf("race-door-%d", i), x.GetId(), ops, expensev1.ExpenseType_EXPENSE_TYPE_ELECTRICITY, 7_000))
		}

		return capitalIn(svc, x.GetId(), 1_000)
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d calls failed", res.Failed())
	}

	// Eight Setor of 1.000, four expenses of 7.000: +8.000 −28.000.
	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 980_000 {
		t.Fatalf("balance = %v, want 980000 — a move was lost", got)
	}

	var rows []m.FinancialAccountLog

	err := h.DB().
		Where("account_id = ? AND change_type = ?", x.GetId(), m.ChangeCapital).
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("read the capital rows: %v", err)
	}

	sent.mu.Lock()
	defer sent.mu.Unlock()

	if len(rows) != 8 || len(sent.events) != 8 {
		t.Fatalf("%d capital rows, %d messages — want eight of each", len(rows), len(sent.events))
	}

	told := map[uint64]int{}
	for _, event := range sent.events {
		told[event.GetFinancialAccountCapitalRecorded().GetLogId()]++
	}

	for _, row := range rows {
		if told[row.ID] != 1 {
			t.Fatalf("row %d told %d times — want once", row.ID, told[row.ID])
		}
	}
}
