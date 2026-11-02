package expense_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// adjust corrects one expense by a signed amount, as the screen's Adjust and Batalkan do.
func adjust(t *testing.T, svc *expense_v1.Service, expenseID uint64, amount int64) *expensev1.ExpenseAdjustResponse {
	t.Helper()

	res, err := tryAdjust(svc, teamA, expenseID, amount)
	if err != nil {
		t.Fatalf("ExpenseAdjust(%d, %d): %v", expenseID, amount, err)
	}

	return res
}

func tryAdjust(svc *expense_v1.Service, team, expenseID uint64, amount int64) (*expensev1.ExpenseAdjustResponse, error) {
	res, err := svc.ExpenseAdjust(context.Background(), connect.NewRequest(&expensev1.ExpenseAdjustRequest{
		TeamId: team, ExpenseId: expenseID, Amount: amount, Note: "typo",
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// September's total, from the list — every row the month holds.
func september(t *testing.T, svc *expense_v1.Service) *expensev1.ExpenseListResponse {
	t.Helper()

	return list(t, svc, &expensev1.ExpenseListRequest{
		TeamId: teamA,
		Filter: &expensev1.ExpenseListFilter{From: "2026-09-01", To: "2026-09-30"},
		Page:   page1(),
	})
}

// THE DECISION'S OWN EXAMPLE (every-correction-is-a-signed-adjustment): expense 77, 5.000.000 on 28 Sep, a typo, is
// corrected by −4.500.000. The expense never changes; the adjustment is a row of its own, on the EXPENSE's day and of
// its kind, and September reads 500.000 with both rows on the list.
func TestExpenseAdjust_IsANewRowOnTheExpensesDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	typo := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 5_000_000, "2026-09-28")

	res := adjust(t, svc, typo.GetId(), -4_500_000)

	got := res.GetAdjustment()
	if got.GetAmount() != -4_500_000 || got.GetAdjustsExpenseId() != typo.GetId() {
		t.Fatalf("adjustment = %d of %d, want −4.500.000 of %d", got.GetAmount(), got.GetAdjustsExpenseId(), typo.GetId())
	}

	// Copied, never typed: the day and the kind are the expense's (an-adjustment-counts-on-the-day-it-fixes).
	if got.GetOccurredAt() != "2026-09-28" || got.GetKind() != expensev1.ExpenseKind_EXPENSE_KIND_ADS {
		t.Fatalf("adjustment on %s as %v, want the expense's 2026-09-28 and ADS", got.GetOccurredAt(), got.GetKind())
	}

	if expense := res.GetExpense(); expense.GetAmount() != 5_000_000 || expense.GetNetAmount() != 500_000 {
		t.Fatalf("expense = %d net %d, want 5.000.000 unchanged and net 500.000", expense.GetAmount(), expense.GetNetAmount())
	}

	month := september(t, svc)
	if month.GetTotals().GetTotal() != 500_000 || month.GetTotals().GetByKind()[int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS)] != 500_000 {
		t.Fatalf("September = %d (ads %d), want 500.000", month.GetTotals().GetTotal(),
			month.GetTotals().GetByKind()[int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS)])
	}

	rows := expenseRows(month)
	if len(rows) != 2 {
		t.Fatalf("September lists %d rows, want the expense and its adjustment", len(rows))
	}

	for _, row := range rows {
		if row.GetId() == typo.GetId() && row.GetNetAmount() != 500_000 {
			t.Fatalf("the listed expense's net = %d, want 500.000", row.GetNetAmount())
		}
	}
}

// BATALKAN is an adjustment of minus what the expense still counts for: the month reads 0 and every row stays.
func TestExpenseAdjust_BatalkanBringsItToZeroAndKeepsTheRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	expense := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 1_200_000, "2026-09-28")

	res := adjust(t, svc, expense.GetId(), -1_200_000)
	if res.GetExpense().GetNetAmount() != 0 {
		t.Fatalf("net after Batalkan = %d, want 0", res.GetExpense().GetNetAmount())
	}

	month := september(t, svc)
	if month.GetTotals().GetTotal() != 0 || len(expenseRows(month)) != 2 {
		t.Fatalf("September = %d over %d rows, want 0 over 2", month.GetTotals().GetTotal(), len(expenseRows(month)))
	}
}

// A correction may ADD too — the person typed too little.
func TestExpenseAdjust_MayAdd(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	expense := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 800_000, "2026-09-05")

	res := adjust(t, svc, expense.GetId(), 50_000)
	if res.GetExpense().GetNetAmount() != 850_000 {
		t.Fatalf("net = %d, want 850.000", res.GetExpense().GetNetAmount())
	}
}

// THE FLOOR: an expense and its adjustments never sum below 0 — a correction cannot turn a cost into income. A second
// correction is measured against what the first left, not against the original amount.
func TestExpenseAdjust_NeverSumsBelowZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	expense := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 5_000_000, "2026-09-28")
	adjust(t, svc, expense.GetId(), -4_500_000)

	_, err := tryAdjust(svc, teamA, expense.GetId(), -1_000_000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("−1.000.000 on a net of 500.000: %v, want FailedPrecondition", err)
	}

	if total := september(t, svc).GetTotals().GetTotal(); total != 500_000 {
		t.Fatalf("September = %d after the refusal, want 500.000 — nothing written", total)
	}
}

// An adjustment corrects an EXPENSE, never another adjustment: a mistaken correction is fixed by a second one on the
// same expense.
func TestExpenseAdjust_RefusesToAdjustAnAdjustment(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	expense := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 5_000_000, "2026-09-28")
	first := adjust(t, svc, expense.GetId(), -4_500_000)

	_, err := tryAdjust(svc, teamA, first.GetAdjustment().GetId(), 4_500_000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("adjusting an adjustment: %v, want FailedPrecondition", err)
	}

	// The fix for a mistaken correction: a second correction of the expense.
	if res := adjust(t, svc, expense.GetId(), 4_000_000); res.GetExpense().GetNetAmount() != 4_500_000 {
		t.Fatalf("net after the second correction = %d, want 4.500.000", res.GetExpense().GetNetAmount())
	}
}

// What the call refuses: an expense that is not there or is another team's — NotFound, never PermissionDenied, so the
// error confirms nothing — and a correction of 0.
func TestExpenseAdjust_Refuses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	expense := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 5_000_000, "2026-09-28")

	cases := map[string]struct {
		team, id uint64
		amount   int64
		want     connect.Code
	}{
		"a missing expense": {teamA, expense.GetId() + 1000, -1, connect.CodeNotFound},
		"another team's":    {teamA + 1, expense.GetId(), -1, connect.CodeNotFound},
		"a correction of 0": {teamA, expense.GetId(), 0, connect.CodeInvalidArgument},
	}

	for name, c := range cases {
		_, err := tryAdjust(svc, c.team, c.id, c.amount)
		if connect.CodeOf(err) != c.want {
			t.Fatalf("%s: %v, want %v", name, err, c.want)
		}
	}
}
