package financial_account_v1_test

import (
	"fmt"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// THE EXPENSE TYPES ON THE ACCOUNT (the-expense-types-prototype-is-accepted, prive-and-deposit-on-pengeluaran-are-the-
// accounts-capital, money-in-on-biaya-is-its-own-change-type): the expense event's TYPE picks the change type and the
// sign — the Iklan group `ads_expense`, Prive / Setoran modal `capital` (out −, in +), Piutang luar diterima and Uang
// masuk lain `money_in` INTO the account, everything else `expense` — and a correction posts the same type, the same way
// round. Every row names the expense it came from.

// typedCreated is expenseCreated with a type.
func typedCreated(eventID string, account uint64, kind expensev1.ExpenseKind, typ expensev1.ExpenseType, amount float64) *eventsv1.Event {
	event := expenseCreated(eventID, account, kind, amount)
	event.GetExpenseCreated().Type = typ

	return event
}

// typedAdjusted is expenseAdjusted with a type.
func typedAdjusted(eventID string, account uint64, kind expensev1.ExpenseKind, typ expensev1.ExpenseType, amount float64) *eventsv1.Event {
	event := expenseAdjusted(eventID, account, kind, amount)
	event.GetExpenseAdjusted().Type = typ

	return event
}

// EACH TYPE POSTS ITS CHANGE TYPE, SIGNED BY ITS DIRECTION — one event per type on its own account.
func TestExpensePayment_EachTypePostsItsChangeTypeAndSign(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ads := expensev1.ExpenseKind_EXPENSE_KIND_ADS
	other := expensev1.ExpenseKind_EXPENSE_KIND_OTHER
	ops := expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL
	pay := expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL

	cases := []struct {
		name       string
		kind       expensev1.ExpenseKind
		typ        expensev1.ExpenseType
		changeType string
		change     float64
	}{
		{"marketplace ads", ads, expensev1.ExpenseType_EXPENSE_TYPE_ADS_MARKETPLACE, m.ChangeAdsExpense, -250_000},
		{"content", ads, expensev1.ExpenseType_EXPENSE_TYPE_CONTENT_ENDORSE, m.ChangeAdsExpense, -300_000},
		{"bonus", pay, expensev1.ExpenseType_EXPENSE_TYPE_BONUS, m.ChangeExpense, -600_000},
		{"discrepancy", ops, expensev1.ExpenseType_EXPENSE_TYPE_DISCREPANCY, m.ChangeExpense, -24_000},
		{"bank fee", ops, expensev1.ExpenseType_EXPENSE_TYPE_BANK_FEE, m.ChangeExpense, -6_500},
		{"outside debt paid", other, expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_DEBT_PAID, m.ChangeExpense, -500_000},
		{"other out", other, expensev1.ExpenseType_EXPENSE_TYPE_OTHER_OUT, m.ChangeExpense, -75_000},
		{"receivable received", other, expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_RECEIVABLE_RECEIVED, m.ChangeMoneyIn, 350_000},
		{"other in", other, expensev1.ExpenseType_EXPENSE_TYPE_OTHER_IN, m.ChangeMoneyIn, 150_000},
		{"prive", other, expensev1.ExpenseType_EXPENSE_TYPE_PRIVE, m.ChangeCapital, -2_000_000},
		{"deposit", other, expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT, m.ChangeCapital, 1_000_000},
		{"an old expense, no type", ops, expensev1.ExpenseType_EXPENSE_TYPE_UNSPECIFIED, m.ChangeExpense, -80_000},
	}

	for i, c := range cases {
		account := mustCreate(t, svc, bca(teamA, "BCA "+c.name, fmt.Sprintf("96000001%02d", i), 5_000_000))

		amount := c.change
		if amount < 0 {
			amount = -amount
		}

		mustPayExpense(t, svc, typedCreated("expense-created:"+c.name, account.GetId(), c.kind, c.typ, amount))

		rows := logs(t, db, account.GetId())
		last := rows[len(rows)-1]

		if last.ChangeType != c.changeType || last.Change != c.change || last.ExpenseID != expenseID {
			t.Fatalf("%s posted %s %v (expense %d), want %s %v from expense %d",
				c.name, last.ChangeType, last.Change, last.ExpenseID, c.changeType, c.change, expenseID)
		}

		if got := balance(t, db, account.GetId()); got != 5_000_000+c.change {
			t.Fatalf("%s: balance = %v, want %v", c.name, got, 5_000_000+c.change)
		}
	}
}

// MONEY IN IS ITS OWN COLUMN — the day's report holds it as `money_in`, never in `expense` (the account's expense rows
// stay spending only).
func TestExpensePayment_MoneyInHasItsOwnReportColumn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	other := expensev1.ExpenseKind_EXPENSE_KIND_OTHER
	mustPayExpense(t, svc, typedCreated("expense-created:1", bcaA.GetId(), other,
		expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_RECEIVABLE_RECEIVED, 350_000))
	mustPayExpense(t, svc, typedCreated("expense-created:2", bcaA.GetId(), other, expensev1.ExpenseType_EXPENSE_TYPE_OTHER_OUT, 75_000))

	report := reportOn(t, db, bcaA.GetId(), spentOn)
	if report == nil || report.MoneyIn != 350_000 || report.Expense != -75_000 || report.Change != 275_000 {
		t.Fatalf("the day's report row = %+v, want money_in 350000, expense −75000, change 275000", report)
	}

	// The wire: the log row reads MONEY_IN and names the expense.
	wire, err := statement(t, svc, teamA, &financial_accountv1.FinancialAccountLogListFilter{AccountId: bcaA.GetId()})
	if err != nil {
		t.Fatalf("FinancialAccountLogList: %v", err)
	}

	found := false
	for _, l := range wire {
		if l.GetChangeType() == financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_MONEY_IN {
			found = l.GetChange() == 350_000 && l.GetExpenseId() == expenseID
		}
	}

	if !found {
		t.Fatalf("no MONEY_IN log of 350000 naming expense %d on the wire", expenseID)
	}
}

// ADJUST AND BATALKAN OF A MONEY-IN AND OF A CAPITAL ROW post the signed correction on the same account as the same
// change type: a money-in reduced takes money back out; a prive cancelled puts the capital back; a deposit cancelled
// takes it out again — each account back where it started.
func TestExpensePayment_CorrectionsOfMoneyInAndCapitalKeepTheirType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	other := expensev1.ExpenseKind_EXPENSE_KIND_OTHER

	for i, c := range []struct {
		name       string
		typ        expensev1.ExpenseType
		amount     float64
		reduce     float64 // the correction's signed amount, as the event carries it
		afterDown  float64 // the balance after the correction, from 1.000.000
		changeType string
	}{
		{"receivable", expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_RECEIVABLE_RECEIVED, 350_000, -50_000, 1_300_000, m.ChangeMoneyIn},
		{"prive", expensev1.ExpenseType_EXPENSE_TYPE_PRIVE, 400_000, -100_000, 700_000, m.ChangeCapital},
		{"deposit", expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT, 600_000, -200_000, 1_400_000, m.ChangeCapital},
	} {
		account := mustCreate(t, svc, bca(teamA, "Acc "+c.name, fmt.Sprintf("97000001%02d", i), 1_000_000))

		mustPayExpense(t, svc, typedCreated("expense-created:"+c.name, account.GetId(), other, c.typ, c.amount))
		mustPayExpense(t, svc, typedAdjusted("expense-adjusted:"+c.name+":1", account.GetId(), other, c.typ, c.reduce))

		if got := balance(t, db, account.GetId()); got != c.afterDown {
			t.Fatalf("%s reduced by %v: balance = %v, want %v", c.name, -c.reduce, got, c.afterDown)
		}

		// Batalkan — minus what it still counts for.
		mustPayExpense(t, svc, typedAdjusted("expense-adjusted:"+c.name+":2", account.GetId(), other, c.typ, -(c.amount+c.reduce)))

		if got := balance(t, db, account.GetId()); got != 1_000_000 {
			t.Fatalf("%s cancelled: balance = %v, want 1000000", c.name, got)
		}

		rows := rowsOfType(t, db, account.GetId(), c.changeType)
		if len(rows) != 3 {
			t.Fatalf("%s: %d %s rows, want the expense and its two corrections", c.name, len(rows), c.changeType)
		}

		for _, r := range rows {
			if r.ExpenseID != expenseID {
				t.Fatalf("%s: a row names expense %d, want %d", c.name, r.ExpenseID, expenseID)
			}
		}

		for _, wrong := range []string{m.ChangeExpense, m.ChangeAdsExpense} {
			if n := len(rowsOfType(t, db, account.GetId(), wrong)); n != 0 {
				t.Fatalf("%s posted %d %s rows", c.name, n, wrong)
			}
		}
	}
}
